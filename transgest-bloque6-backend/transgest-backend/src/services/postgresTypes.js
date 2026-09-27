const { types } = require('pg');

// A SQL DATE is a calendar date, not an instant in the server's timezone.
// pg's default Date conversion shifts it when serialized as UTC in Madrid.
// Keep timestamps on pg's normal parser and scope the override to our pools.
module.exports = {
  getTypeParser(oid, format) {
    if (oid === 1082 && (!format || format === 'text')) return value => value;
    return types.getTypeParser(oid, format);
  },
};
