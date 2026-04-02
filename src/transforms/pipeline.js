/**
 * Transform pipeline with undo/redo history.
 * Zero external dependencies.
 */

const MAX_HISTORY = 50;

function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  if (obj instanceof Date) return new Date(obj.getTime());
  const clone = {};
  for (const key of Object.keys(obj)) {
    clone[key] = deepClone(obj[key]);
  }
  return clone;
}

class Pipeline {
  /**
   * @param {object} initialData - The initial DataTable
   */
  constructor(initialData) {
    this._original = deepClone(initialData);
    this._current = deepClone(initialData);
    this._undoStack = []; // { description, timestamp, state }
    this._redoStack = [];
  }

  /**
   * Apply a transform function to the current state.
   * @param {function} transformFn - Receives current DataTable, returns new DataTable
   * @param {string} description - Human-readable description of the transform
   * @returns {object} The new current state
   */
  apply(transformFn, description) {
    // Save current state to undo stack before transforming
    this._undoStack.push({
      description,
      timestamp: new Date().toISOString(),
      state: deepClone(this._current),
    });

    // Enforce max history — drop oldest entries
    while (this._undoStack.length > MAX_HISTORY) {
      this._undoStack.shift();
    }

    // Clear redo stack on new apply (standard undo/redo behavior)
    this._redoStack = [];

    this._current = transformFn(deepClone(this._current));
    return deepClone(this._current);
  }

  /**
   * Revert to previous state.
   * @returns {object|null} The restored state, or null if nothing to undo
   */
  undo() {
    if (!this.canUndo()) return null;

    const entry = this._undoStack.pop();
    this._redoStack.push({
      description: entry.description,
      timestamp: entry.timestamp,
      state: deepClone(this._current),
    });

    this._current = deepClone(entry.state);
    return deepClone(this._current);
  }

  /**
   * Re-apply a previously undone transform.
   * @returns {object|null} The restored state, or null if nothing to redo
   */
  redo() {
    if (!this.canRedo()) return null;

    const entry = this._redoStack.pop();
    this._undoStack.push({
      description: entry.description,
      timestamp: entry.timestamp,
      state: deepClone(this._current),
    });

    this._current = deepClone(entry.state);
    return deepClone(this._current);
  }

  /**
   * Preview a transform without modifying state.
   * @param {function} transformFn - Transform to preview
   * @returns {object} Deep clone with the transform applied
   */
  preview(transformFn) {
    return transformFn(deepClone(this._current));
  }

  /**
   * Get the history of applied transforms.
   * @returns {Array<{description: string, timestamp: string}>}
   */
  history() {
    return this._undoStack.map(({ description, timestamp }) => ({
      description,
      timestamp,
    }));
  }

  /** @returns {boolean} */
  canUndo() {
    return this._undoStack.length > 0;
  }

  /** @returns {boolean} */
  canRedo() {
    return this._redoStack.length > 0;
  }

  /**
   * Clear all history and restore to original state.
   */
  reset() {
    this._current = deepClone(this._original);
    this._undoStack = [];
    this._redoStack = [];
  }

  /** Get current state (deep clone). */
  get current() {
    return deepClone(this._current);
  }
}

module.exports = { Pipeline };
