var _ = require('underscore');
var utils = require('keystone-utils');
var keystone = require('../../');
var debug = require('debug')('keystone:schemaPlugins:autokey');

module.exports = function autokey() {
	var AutokeyModel = null;
	var AutokeySchema = new keystone.mongoose.Schema({
		next: { type: Number },
		path: { type: String, unique: true }
	}, { collection: keystone.prefixModel('Autokey') });

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
	}

	this.schema.add(def);

	var getUniqueKey = function(doc, src, callback) {

		//Test
		var newKey = list.model.modelName+':'+src;
		AutokeyModel.findOneAndUpdate(
			{ path: newKey },
			{ $set: { path: newKey }, $inc: { next: 1 } },
			{ new: false, upsert: true },
			function(err, result) {
				if(result) {
					doc.set(autokey.path, src+'-'+result.next);
				} else {
					doc.set(autokey.path, src);
				}
				return callback();
			}
		);
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
