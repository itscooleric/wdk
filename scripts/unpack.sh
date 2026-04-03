#!/usr/bin/env bash
# unpack.sh — Reassemble a file from chunks produced by pack.sh
# Usage: ./unpack.sh <packed_dir> [output_file]
#
# Reads manifest.txt from the directory, then cats chunks in order.

set -euo pipefail

PACKDIR="${1:-}"
OUTPUT="${2:-}"

if [[ -z "$PACKDIR" ]]; then
    echo "Usage: $0 <packed_dir> [output_file]" >&2
    echo "  packed_dir  — directory containing manifest.txt and chunk_*.txt files" >&2
    echo "  output_file — where to write result (default: original filename from manifest)" >&2
    exit 1
fi

if [[ ! -d "$PACKDIR" ]]; then
    echo "Error: directory not found: $PACKDIR" >&2
    exit 1
fi

MANIFEST="$PACKDIR/manifest.txt"
if [[ ! -f "$MANIFEST" ]]; then
    echo "Error: manifest.txt not found in $PACKDIR" >&2
    exit 1
fi

# Parse manifest (key=value lines, no eval)
read_manifest_key() {
    grep "^${1}=" "$MANIFEST" | cut -d= -f2-
}

PACK_VERSION=$(read_manifest_key PACK_VERSION)
if [[ "$PACK_VERSION" != "1" ]]; then
    echo "Error: unsupported pack version: $PACK_VERSION" >&2
    exit 1
fi

ORIGINAL_FILE=$(read_manifest_key ORIGINAL_FILE)
ORIGINAL_SIZE=$(read_manifest_key ORIGINAL_SIZE)
TOTAL_CHUNKS=$(read_manifest_key TOTAL_CHUNKS)

OUTPUT="${OUTPUT:-$ORIGINAL_FILE}"

echo "Unpacking: $ORIGINAL_FILE ($ORIGINAL_SIZE bytes, $TOTAL_CHUNKS chunk(s))"
echo "Output:    $OUTPUT"

# Verify all chunks exist before writing anything
MISSING=0
for i in $(seq 1 $TOTAL_CHUNKS); do
    CHUNK="$PACKDIR/chunk_$(printf '%02d' $i).txt"
    if [[ ! -f "$CHUNK" ]]; then
        echo "Error: missing chunk: $CHUNK" >&2
        MISSING=$(( MISSING + 1 ))
    fi
done

if [[ $MISSING -gt 0 ]]; then
    echo "Aborting: $MISSING chunk(s) missing." >&2
    exit 1
fi

# Verify chunk sizes match manifest
SIZE_ERRORS=0
for i in $(seq 1 $TOTAL_CHUNKS); do
    CHUNK="$PACKDIR/chunk_$(printf '%02d' $i).txt"
    EXPECTED=$(read_manifest_key "CHUNK_$(printf '%02d' $i)_SIZE")
    ACTUAL=$(wc -c < "$CHUNK")
    if [[ "$ACTUAL" != "$EXPECTED" ]]; then
        echo "Warning: chunk_$(printf '%02d' $i).txt size mismatch (expected $EXPECTED, got $ACTUAL)" >&2
        SIZE_ERRORS=$(( SIZE_ERRORS + 1 ))
    fi
done

if [[ $SIZE_ERRORS -gt 0 ]]; then
    echo "Warning: $SIZE_ERRORS chunk(s) have size mismatches — file may be corrupted or transferred incorrectly." >&2
    read -p "Continue anyway? [y/N] " CONFIRM
    if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
        echo "Aborted." >&2
        exit 1
    fi
fi

# Reassemble: cat chunks in order into output file
> "$OUTPUT"
for i in $(seq 1 $TOTAL_CHUNKS); do
    CHUNK="$PACKDIR/chunk_$(printf '%02d' $i).txt"
    cat "$CHUNK" >> "$OUTPUT"
done

RESULT_SIZE=$(wc -c < "$OUTPUT")
echo ""
if [[ "$RESULT_SIZE" == "$ORIGINAL_SIZE" ]]; then
    echo "OK — reassembled $OUTPUT ($RESULT_SIZE bytes, matches manifest)"
else
    echo "Warning: size mismatch — expected $ORIGINAL_SIZE bytes, got $RESULT_SIZE bytes" >&2
    echo "The file may have been truncated or had extra whitespace added during transfer." >&2
    exit 1
fi
