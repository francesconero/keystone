var _ = require('underscore');
var utils = require('keystone-utils');
var keystone = require('../../');
var debug = require('debug')('keystone:schemaPlugins:autokey');

module.exports = function autokey() {
	// This is the schema which defines an autokey
	// There should be a better place to put it, but I'm not expert enough to
	// know where
	var AutokeyModel = null;
	var AutokeySchema = new keystone.mongoose.Schema({
		model: { type: String },
		kvs: [{ key: 'string', value: 'string' }],
		key: { type: String },
		path: { type: String }
	}, { collection: keystone.prefixModel('Autokey') });
	AutokeySchema.index({key: 1, model: -1}, {unique: true});
	// This horrible IF is a consequence of the above
	if (keystone.mongoose.models.Autokey) {
		AutokeyModel = keystone.mongoose.model('Autokey');
	} else {
		AutokeyModel = keystone.mongoose.model('Autokey', AutokeySchema);
	}

	var autokey = this.autokey = _.clone(this.get('autokey'));
	var def = {};
	var list = this;

	if (!autokey.from) {
		var fromMsg = 'Invalid List Option (autokey) for ' + list.key + ' (from is required)\n';
		throw new Error(fromMsg);
	}
	if (!autokey.path) {
		var pathMsg = 'Invalid List Option (autokey) for ' + list.key + ' (path is required)\n';
		throw new Error(pathMsg);
	}

	if ('string' === typeof autokey.from) {
		autokey.from = autokey.from.split(' ');
	}

	autokey.from = autokey.from.map(function(i) {
		i = i.split(':');
		return { path: i[0], format: i[1] };
	});

	def[autokey.path] = {
		type: String,
		index: true
	};

	if (autokey.unique) {
		def[autokey.path].index = { unique: true };

		if (autokey.sparse) {
			def[autokey.path].index.sparse = true;
		}
	}

	this.schema.add(def);

	var getUniqueKey = function(doc, src, callback){
		// Save the former functionality somehow, even if I don't really know
		// what it did (is it documented?)
		var kvsQuery = [];
		if (_.isObject(autokey.unique)) {
			_.each(autokey.unique, function(k, v) {
				if (_.isString(v) && v.charAt(0) === ':') {
					out.push({kvs:{ $elemMatch: {key: k, value: doc.get(v.substr(1))}}});
				} else {
					out.push({kvs:{ $elemMatch: {key: k, value: v }}});
				}
			});
		}
		var kvsUpdate = _.compact(_.pluck(_.pluck(kvsQuery, 'kvs'), '$elemMatch'));
		var query = {
			model: list.model.modelName,
			path:  autokey.path,
			key: src
		};

		var update = {
			$setOnInsert: {
				path: autokey.path,
				key: src
			}
		};

		if(kvsUpdate.length>0){
			query.$and = kvsQuery;
			update.$setOnInsert.kvs = kvsUpdate;
		}

		// Exploit the atomicity of the findOneAndUpdate query to check if the
		// candidate autokey is already present in the database.
		// If it is, generate recursively a new key, otherwise the mongoose
		// method guarantees us that the autokey was atomically saved in the db.
		AutokeyModel.findOneAndUpdate(
			query,
			update,
			{ upsert: true,
				new: false
			},
			function(err, result) {
				if (err) {
					callback(err);
				} else if (result) {
					var inc = src.match(/^(.+)\-(\d+)$/);
					if (inc && inc.length === 3) {
						src = inc[1];
						inc = '-' + ((inc[2] * 1) + 1);
					} else {
						inc = '-1';
					}
					return getUniqueKey(doc, src + inc, callback);
				} else {
					doc.set(autokey.path, src);
					return callback();
				}
			});
	};

	this.schema.pre('save', function(next) {

		var modified = false;
		var values = [];

		autokey.from.forEach(function(ops) {
			if (list.fields[ops.path]) {
				values.push(list.fields[ops.path].format(this, ops.format));
				if (list.fields[ops.path].isModified(this)) {
					modified = true;
				}
			} else {
				values.push(this.get(ops.path));
				// virtual paths are always assumed to have changed, except 'id'
				if (ops.path !== 'id' && list.schema.pathType(ops.path) === 'virtual' || this.isModified(ops.path)) {
					modified = true;
				}
			}
		}, this);

		// if has a value and is unmodified or fixed, don't update it
		if ((!modified || autokey.fixed) && this.get(autokey.path)) {
			return next();
		}
		var newKey = utils.slug(values.join(' '), null, { locale: autokey.locale }) || this.id;
		if (autokey.unique) {
			return getUniqueKey(this, newKey, next);
		} else {
			this.set(autokey.path, newKey);
			return next();
		}

	});

};
