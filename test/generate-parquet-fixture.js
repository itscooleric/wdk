#!/usr/bin/env node

/**
 * Generate a minimal valid Parquet test file using raw binary construction.
 * Uses TCompactProtocol for Thrift encoding, matching hyparquet's parser.
 *
 * Run: node test/generate-parquet-fixture.js
 */

var fs = require('fs');
var path = require('path');

// TCompactProtocol type IDs (matching hyparquet's thrift.js)
var STOP = 0, TRUE_TYPE = 1, FALSE_TYPE = 2, BYTE = 3, I16 = 4, I32 = 5, I64 = 6;
var DOUBLE = 7, BINARY = 8, LIST = 9, STRUCT = 12;

function Writer() { this.buf = []; this.lastFid = 0; }
Writer.prototype.byte = function (b) { this.buf.push(b & 0xff); };
Writer.prototype.bytes = function (arr) { for (var i = 0; i < arr.length; i++) this.buf.push(arr[i]); };
Writer.prototype.varint = function (n) {
  n = n >>> 0;
  while (n > 0x7f) { this.buf.push((n & 0x7f) | 0x80); n >>>= 7; }
  this.buf.push(n & 0x7f);
};
Writer.prototype.zigzag = function (n) { this.varint((n << 1) ^ (n >> 31)); };
Writer.prototype.zigzagBig = function (n) {
  // For small positive numbers, zigzag is just n*2
  if (n >= 0 && n < 0x40000000) { this.varint(n * 2); }
  else { this.varint((n << 1) ^ (n >> 31)); }
};
Writer.prototype.field = function (type, id) {
  var delta = id - this.lastFid;
  if (delta > 0 && delta < 16) { this.byte((delta << 4) | type); }
  else { this.byte(type); this.zigzag(id); }
  this.lastFid = id;
};
Writer.prototype.fieldI32 = function (id, val) { this.field(I32, id); this.zigzag(val); };
Writer.prototype.fieldI64 = function (id, val) { this.field(I64, id); this.zigzagBig(val); };
Writer.prototype.fieldString = function (id, val) {
  this.field(BINARY, id);
  var enc = Buffer.from(val, 'utf8');
  this.varint(enc.length);
  this.bytes(enc);
};
Writer.prototype.fieldStruct = function (id) { this.field(STRUCT, id); };
Writer.prototype.stop = function () { this.byte(STOP); this.lastFid = 0; };
Writer.prototype.listHeader = function (id, elemType, count) {
  this.field(LIST, id);
  if (count < 15) { this.byte((count << 4) | elemType); }
  else { this.byte(0xf0 | elemType); this.varint(count); }
};
Writer.prototype.toBuffer = function () { return Buffer.from(this.buf); };

// === Build schema elements ===
// Parquet SchemaElement Thrift fields:
//   1: type (i32), 2: type_length (i32), 3: repetition_type (i32),
//   4: name (string), 5: num_children (i32), 6: converted_type (i32)
function schemaElement(name, opts) {
  var w = new Writer();
  if (opts.type != null) w.fieldI32(1, opts.type);
  if (opts.repetition != null) w.fieldI32(3, opts.repetition);
  w.fieldString(4, name);
  if (opts.numChildren != null) w.fieldI32(5, opts.numChildren);
  w.stop();
  return w.buf;
}

// === Build data page header (PageHeader thrift struct) ===
function pageHeader(numValues, uncompressedSize, compressedSize) {
  var w = new Writer();
  w.fieldI32(1, 0);  // type: DATA_PAGE
  w.fieldI32(2, uncompressedSize);
  w.fieldI32(3, compressedSize);
  // data_page_header (field 5, struct)
  w.fieldStruct(5);
  w.fieldI32(1, numValues);
  w.fieldI32(2, 0);  // encoding: PLAIN
  w.fieldI32(3, 0);  // definition_level_encoding: PLAIN
  w.fieldI32(4, 0);  // repetition_level_encoding: PLAIN
  w.stop();
  w.stop();
  return w.toBuffer();
}

// === Encode column data ===
var NUM_ROWS = 100;
var ids = [], names = [], values = [];
for (var i = 0; i < NUM_ROWS; i++) {
  ids.push(i);
  names.push('item_' + i);
  values.push(Math.round(Math.sin(i) * 10000) / 10000);
}

function encodeInt32(arr) {
  var buf = Buffer.alloc(arr.length * 4);
  for (var i = 0; i < arr.length; i++) buf.writeInt32LE(arr[i], i * 4);
  return buf;
}

function encodeByteArray(arr) {
  var parts = [];
  for (var i = 0; i < arr.length; i++) {
    var s = Buffer.from(arr[i], 'utf8');
    var l = Buffer.alloc(4);
    l.writeInt32LE(s.length, 0);
    parts.push(l, s);
  }
  return Buffer.concat(parts);
}

function encodeDouble(arr) {
  var buf = Buffer.alloc(arr.length * 8);
  for (var i = 0; i < arr.length; i++) buf.writeDoubleLE(arr[i], i * 8);
  return buf;
}

var idData = encodeInt32(ids);
var nameData = encodeByteArray(names);
var valueData = encodeDouble(values);

var idPH = pageHeader(NUM_ROWS, idData.length, idData.length);
var namePH = pageHeader(NUM_ROWS, nameData.length, nameData.length);
var valuePH = pageHeader(NUM_ROWS, valueData.length, valueData.length);

var idPage = Buffer.concat([idPH, idData]);
var namePage = Buffer.concat([namePH, nameData]);
var valuePage = Buffer.concat([valuePH, valueData]);

var magic = Buffer.from('PAR1');

var idOffset = magic.length;
var nameOffset = idOffset + idPage.length;
var valueOffset = nameOffset + namePage.length;

// === Build ColumnMetaData ===
function columnMetaData(type, pathInSchema, numValues, totalUncomp, totalComp, dataPageOffset) {
  var w = new Writer();
  w.fieldI32(1, type);  // type
  // encodings: list of i32
  w.listHeader(2, I32, 1);
  w.zigzag(0); // PLAIN = 0
  // path_in_schema: list of binary (strings)
  w.listHeader(3, BINARY, pathInSchema.length);
  for (var i = 0; i < pathInSchema.length; i++) {
    var enc = Buffer.from(pathInSchema[i], 'utf8');
    w.varint(enc.length);
    w.bytes(enc);
  }
  w.fieldI32(4, 0);  // codec: UNCOMPRESSED
  w.fieldI64(5, numValues);
  w.fieldI64(6, totalUncomp);
  w.fieldI64(7, totalComp);
  w.fieldI64(9, dataPageOffset);
  w.stop();
  return w.buf;
}

// === Build ColumnChunk ===
function columnChunk(colMeta, fileOffset) {
  var w = new Writer();
  w.fieldI64(2, fileOffset);
  w.fieldStruct(3);  // meta_data
  w.bytes(colMeta);
  w.stop();
  return w.buf;
}

// === Build RowGroup ===
function rowGroup(chunks, totalByteSize, numRows) {
  var w = new Writer();
  // columns: list of struct
  w.listHeader(1, STRUCT, chunks.length);
  for (var i = 0; i < chunks.length; i++) w.bytes(chunks[i]);
  w.fieldI64(2, totalByteSize);
  w.fieldI64(3, numRows);
  w.stop();
  return w.buf;
}

// === Build FileMetaData ===
function fileMetaData(version, schemaElements, rowGroups, numRows, createdBy) {
  var w = new Writer();
  w.fieldI32(1, version);
  // schema: list of struct
  w.listHeader(2, STRUCT, schemaElements.length);
  for (var i = 0; i < schemaElements.length; i++) w.bytes(schemaElements[i]);
  w.fieldI64(3, numRows);
  // row_groups: list of struct
  w.listHeader(4, STRUCT, rowGroups.length);
  for (var i = 0; i < rowGroups.length; i++) w.bytes(rowGroups[i]);
  if (createdBy) w.fieldString(6, createdBy);
  w.stop();
  return w.toBuffer();
}

// Assemble
var idColMeta = columnMetaData(1, ['id'], NUM_ROWS, idPage.length, idPage.length, idOffset);       // INT32
var nameColMeta = columnMetaData(6, ['name'], NUM_ROWS, namePage.length, namePage.length, nameOffset);   // BYTE_ARRAY
var valueColMeta = columnMetaData(5, ['value'], NUM_ROWS, valuePage.length, valuePage.length, valueOffset); // DOUBLE

var idChunk = columnChunk(idColMeta, idOffset);
var nameChunk = columnChunk(nameColMeta, nameOffset);
var valueChunk = columnChunk(valueColMeta, valueOffset);

var totalDataSize = idPage.length + namePage.length + valuePage.length;
var rg = rowGroup([idChunk, nameChunk, valueChunk], totalDataSize, NUM_ROWS);

// Parquet type enum: 0=BOOLEAN, 1=INT32, 2=INT64, 3=INT96, 4=FLOAT, 5=DOUBLE, 6=BYTE_ARRAY, 7=FIXED_LEN_BYTE_ARRAY
var schema = [
  schemaElement('root', { repetition: null, numChildren: 3 }),
  schemaElement('id', { type: 1, repetition: 0 }),     // INT32, REQUIRED
  schemaElement('name', { type: 6, repetition: 0 }),   // BYTE_ARRAY, REQUIRED
  schemaElement('value', { type: 5, repetition: 0 })   // DOUBLE, REQUIRED
];

var fileMeta = fileMetaData(1, schema, [rg], NUM_ROWS, 'wdk-test-generator');

var metaLenBuf = Buffer.alloc(4);
metaLenBuf.writeInt32LE(fileMeta.length, 0);

var fullFile = Buffer.concat([magic, idPage, namePage, valuePage, fileMeta, metaLenBuf, magic]);

var fixtureDir = path.join(__dirname, 'fixtures');
if (!fs.existsSync(fixtureDir)) fs.mkdirSync(fixtureDir, { recursive: true });
var outPath = path.join(fixtureDir, 'test.parquet');
fs.writeFileSync(outPath, fullFile);
console.log('Generated: ' + outPath + ' (' + fullFile.length + ' bytes, ' + NUM_ROWS + ' rows, 3 columns)');

// Verify with hyparquet
import('../node_modules/hyparquet/src/index.js').then(function (hp) {
  try {
    var u8 = new Uint8Array(fullFile.length);
    for (var x = 0; x < fullFile.length; x++) u8[x] = fullFile[x];
    var ab = u8.buffer;
    var meta = hp.parquetMetadata(ab);
    console.log('Verification: hyparquet parsed metadata successfully');
    console.log('  num_rows:', meta.num_rows != null ? Number(meta.num_rows) : 'N/A');
    console.log('  schema elements:', meta.schema ? meta.schema.length : 'N/A');
    console.log('  row groups:', meta.row_groups ? meta.row_groups.length : 'N/A');
  } catch (e) {
    console.error('Verification FAILED:', e.message);
    process.exit(1);
  }
}).catch(function (e) {
  console.error('Import error:', e.message);
});
