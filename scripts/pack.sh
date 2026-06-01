#!/usr/bin/env bash
# pack.sh — Split a file into numbered chunks with a manifest
# Usage: ./pack.sh <input_file> [output_dir]
#
# Constraints this tool respects:
#   - Max 10 output files (9 chunks + 1 manifest = 10 total)
#   - Each chunk is plain text (no encoding)
#   - Chunk size auto-calculated to stay under 1MB and within file limit
#   - Works with any text-safe file (HTML, JS, JSON, CSS, etc.)

set -euo pipefail

INPUT="${1:-}"
OUTDIR="${2:-}"

if [[ -z "$INPUT" ]]; then
    echo "Usage: $0 <input_file> [output_dir]" >&2
    echo "  input_file  — file to pack (any text file)" >&2
    echo "  output_dir  — where to write chunks (default: <basename>_packed/)" >&2
    exit 1
fi

if [[ ! -f "$INPUT" ]]; then
    echo "Error: input file not found: $INPUT" >&2
    exit 1
fi

BASENAME="$(basename "$INPUT")"
OUTDIR="${OUTDIR:-${BASENAME%.*}_packed}"

mkdir -p "$OUTDIR"

# Constraints
MAX_FILES=9          # 9 data chunks + 1 manifest = 10 total
MAX_CHUNK_BYTES=$((900 * 1024))  # 900KB per chunk (headroom under 1MB)

FILESIZE=$(wc -c < "$INPUT")
echo "Input: $INPUT ($FILESIZE bytes)"

# Calculate chunk size: smallest of (ceil(size/9), 900KB)
AUTO_CHUNK=$(( (FILESIZE + MAX_FILES - 1) / MAX_FILES ))
CHUNK_SIZE=$(( AUTO_CHUNK < MAX_CHUNK_BYTES ? AUTO_CHUNK : MAX_CHUNK_BYTES ))

# Validate: can we fit in 9 chunks?
NEEDED=$(( (FILESIZE + CHUNK_SIZE - 1) / CHUNK_SIZE ))
if [[ $NEEDED -gt $MAX_FILES ]]; then
    echo "Error: file too large to split into $MAX_FILES chunks under 1MB each." >&2
    echo "  File size: $FILESIZE bytes, would need $NEEDED chunks." >&2
    echo "  Maximum supported input: $((MAX_FILES * MAX_CHUNK_BYTES)) bytes (~$((MAX_FILES * 900 / 1024))MB)" >&2
    exit 1
fi

# Split the file using dd (byte-accurate, no external deps beyond coreutils)
CHUNK_NUM=0
OFFSET=0
WRITTEN_CHUNKS=()
declare -A CHUNK_SIZES

echo "Splitting into chunks of up to $CHUNK_SIZE bytes..."

while [[ $OFFSET -lt $FILESIZE ]]; do
    CHUNK_NUM=$(( CHUNK_NUM + 1 ))
    CHUNK_FILE="$OUTDIR/chunk_$(printf '%02d' $CHUNK_NUM).txt"

    dd if="$INPUT" of="$CHUNK_FILE" bs=1 skip="$OFFSET" count="$CHUNK_SIZE" 2>/dev/null

    ACTUAL=$(wc -c < "$CHUNK_FILE")
    CHUNK_SIZES[$CHUNK_NUM]=$ACTUAL
    WRITTEN_CHUNKS+=("$CHUNK_FILE")
    echo "  chunk_$(printf '%02d' $CHUNK_NUM).txt — $ACTUAL bytes"

    OFFSET=$(( OFFSET + CHUNK_SIZE ))
done

TOTAL_CHUNKS=$CHUNK_NUM

# Write manifest
MANIFEST="$OUTDIR/manifest.txt"
{
    echo "PACK_VERSION=1"
    echo "ORIGINAL_FILE=$BASENAME"
    echo "ORIGINAL_SIZE=$FILESIZE"
    echo "TOTAL_CHUNKS=$TOTAL_CHUNKS"
    echo "CHUNK_SIZE=$CHUNK_SIZE"
    for i in $(seq 1 $TOTAL_CHUNKS); do
        echo "CHUNK_$(printf '%02d' $i)_SIZE=${CHUNK_SIZES[$i]}"
    done
} > "$MANIFEST"

echo ""
echo "Done. $TOTAL_CHUNKS chunk(s) + manifest written to: $OUTDIR/"
echo "Files to transfer ($(( TOTAL_CHUNKS + 1 )) total):"
echo "  $MANIFEST"
for f in "${WRITTEN_CHUNKS[@]}"; do echo "  $f"; done
echo ""
echo "Reassemble with: ./unpack.sh $OUTDIR/"
