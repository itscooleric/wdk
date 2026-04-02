class DataTable {
  constructor(headers = [], rows = []) {
    this._headers = [...headers];
    this._rows = rows.map(r => [...r]);
  }

  get rowCount() { return this._rows.length; }
  get columnCount() { return this._headers.length; }

  // --- Column operations ---

  addColumn(name, defaultVal = '') {
    this._headers.push(name);
    for (const row of this._rows) {
      row.push(defaultVal);
    }
  }

  removeColumn(name) {
    const idx = this._headers.indexOf(name);
    if (idx === -1) throw new Error(`Column "${name}" not found`);
    this._headers.splice(idx, 1);
    for (const row of this._rows) {
      row.splice(idx, 1);
    }
  }

  renameColumn(oldName, newName) {
    const idx = this._headers.indexOf(oldName);
    if (idx === -1) throw new Error(`Column "${oldName}" not found`);
    this._headers[idx] = newName;
  }

  reorderColumns(newOrder) {
    const indices = newOrder.map(name => {
      const idx = this._headers.indexOf(name);
      if (idx === -1) throw new Error(`Column "${name}" not found`);
      return idx;
    });
    this._headers = indices.map(i => this._headers[i]);
    this._rows = this._rows.map(row => indices.map(i => row[i]));
  }

  getColumn(name) {
    const idx = this._headers.indexOf(name);
    if (idx === -1) throw new Error(`Column "${name}" not found`);
    return this._rows.map(row => row[idx]);
  }

  // --- Row operations ---

  addRow(values) {
    const row = [...values];
    while (row.length < this._headers.length) row.push('');
    this._rows.push(row.slice(0, this._headers.length));
  }

  removeRow(index) {
    if (index < 0 || index >= this._rows.length) throw new RangeError(`Row index ${index} out of bounds`);
    this._rows.splice(index, 1);
  }

  getRow(index) {
    if (index < 0 || index >= this._rows.length) throw new RangeError(`Row index ${index} out of bounds`);
    return [...this._rows[index]];
  }

  filterRows(predicate) {
    const table = new DataTable(this._headers);
    table._rows = this._rows.filter((row, i) => predicate(row, i));
    return table;
  }

  sortRows(columnName, ascending = true) {
    const idx = this._headers.indexOf(columnName);
    if (idx === -1) throw new Error(`Column "${columnName}" not found`);
    const sorted = [...this._rows].sort((a, b) => {
      if (a[idx] < b[idx]) return ascending ? -1 : 1;
      if (a[idx] > b[idx]) return ascending ? 1 : -1;
      return 0;
    });
    const table = new DataTable(this._headers);
    table._rows = sorted;
    return table;
  }

  // --- Utilities ---

  clone() {
    return new DataTable(this._headers, this._rows);
  }

  toObjects() {
    return this._rows.map(row => {
      const obj = {};
      this._headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
  }
}

module.exports = { DataTable };
