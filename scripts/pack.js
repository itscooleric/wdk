#!/usr/bin/env node
// pack.js — Pack/unpack a file for restricted transfer environments
// Node.js version of pack.sh / unpack.sh
//
// Usage:
//   node pack.js pack   <input_file> [output_dir]
//   node pack.js unpack <packed_dir> [output_file]
//
// Constraints:
//   - Max 10 total files (9 chunks + 1 manifest)
//   - Each chunk under 1MB
//   - No encoding — plain text passthrough
//   - Works on Node.js 12+ with no dependencies

'use strict';

const fs = require('fs');
const path = require('path');

const MAX_CHUNKS = 9;
const MAX_CHUNK_BYTES = 900 * 1024; // 900KB

// ── Helpers ──────────────────────────────────────────────────────────────────

function chunkName(n) {
    return `chunk_${String(n).padStart(2, '0')}.txt`;
}

function die(msg) {
    console.error('Error:', msg);
    process.exit(1);
}

// ── Pack ─────────────────────────────────────────────────────────────────────

function pack(inputFile, outDir) {
    if (!fs.existsSync(inputFile)) die(`input file not found: ${inputFile}`);

    const basename = path.basename(inputFile);
    outDir = outDir || basename.replace(/\.[^.]+$/, '') + '_packed';
    fs.mkdirSync(outDir, { recursive: true });

    const data = fs.readFileSync(inputFile); // Buffer
    const fileSize = data.length;

    console.log(`Input: ${inputFile} (${fileSize} bytes)`);

    // Auto-calculate chunk size
    const autoChunk = Math.ceil(fileSize / MAX_CHUNKS);
    const chunkSize = Math.min(autoChunk, MAX_CHUNK_BYTES);
    const neededChunks = Math.ceil(fileSize / chunkSize);

    if (neededChunks > MAX_CHUNKS) {
        die(
            `File too large: ${fileSize} bytes would need ${neededChunks} chunks.\n` +
            `Maximum supported input: ${MAX_CHUNKS * MAX_CHUNK_BYTES} bytes (~${Math.floor(MAX_CHUNKS * 900 / 1024)}MB)`
        );
    }

    console.log(`Splitting into chunks of up to ${chunkSize} bytes...`);

    const manifest = {
        PACK_VERSION: '1',
        ORIGINAL_FILE: basename,
        ORIGINAL_SIZE: fileSize,
        TOTAL_CHUNKS: 0,
        CHUNK_SIZE: chunkSize,
        chunks: [],
    };

    let offset = 0;
    let chunkNum = 0;

    while (offset < fileSize) {
        chunkNum++;
        const slice = data.slice(offset, offset + chunkSize);
        const fname = chunkName(chunkNum);
        fs.writeFileSync(path.join(outDir, fname), slice);
        console.log(`  ${fname} — ${slice.length} bytes`);
        manifest.chunks.push({ num: chunkNum, size: slice.length });
        offset += chunkSize;
    }

    manifest.TOTAL_CHUNKS = chunkNum;

    // Write manifest as key=value (same format as shell version)
    const manifestLines = [
        `PACK_VERSION=${manifest.PACK_VERSION}`,
        `ORIGINAL_FILE=${manifest.ORIGINAL_FILE}`,
        `ORIGINAL_SIZE=${manifest.ORIGINAL_SIZE}`,
        `TOTAL_CHUNKS=${manifest.TOTAL_CHUNKS}`,
        `CHUNK_SIZE=${manifest.CHUNK_SIZE}`,
        ...manifest.chunks.map(c => `CHUNK_${String(c.num).padStart(2, '0')}_SIZE=${c.size}`),
    ];
    fs.writeFileSync(path.join(outDir, 'manifest.txt'), manifestLines.join('\n') + '\n');

    console.log('');
    console.log(`Done. ${chunkNum} chunk(s) + manifest written to: ${outDir}/`);
    console.log(`Files to transfer (${chunkNum + 1} total):`);
    console.log(`  ${path.join(outDir, 'manifest.txt')}`);
    for (let i = 1; i <= chunkNum; i++) {
        console.log(`  ${path.join(outDir, chunkName(i))}`);
    }
    console.log('');
    console.log(`Reassemble with: node pack.js unpack ${outDir}/`);
}

// ── Unpack ───────────────────────────────────────────────────────────────────

function unpack(packDir, outputFile) {
    if (!fs.existsSync(packDir)) die(`directory not found: ${packDir}`);

    const manifestPath = path.join(packDir, 'manifest.txt');
    if (!fs.existsSync(manifestPath)) die(`manifest.txt not found in ${packDir}`);

    // Parse key=value manifest
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const kv = {};
    for (const line of raw.split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) kv[line.slice(0, eq)] = line.slice(eq + 1);
    }

    if (kv.PACK_VERSION !== '1') die(`unsupported pack version: ${kv.PACK_VERSION}`);

    const originalFile = kv.ORIGINAL_FILE;
    const originalSize = parseInt(kv.ORIGINAL_SIZE, 10);
    const totalChunks = parseInt(kv.TOTAL_CHUNKS, 10);

    outputFile = outputFile || originalFile;

    console.log(`Unpacking: ${originalFile} (${originalSize} bytes, ${totalChunks} chunk(s))`);
    console.log(`Output:    ${outputFile}`);

    // Verify all chunks exist
    const missing = [];
    for (let i = 1; i <= totalChunks; i++) {
        const p = path.join(packDir, chunkName(i));
        if (!fs.existsSync(p)) missing.push(chunkName(i));
    }
    if (missing.length > 0) die(`Missing chunks: ${missing.join(', ')}`);

    // Verify sizes
    let sizeErrors = 0;
    for (let i = 1; i <= totalChunks; i++) {
        const key = `CHUNK_${String(i).padStart(2, '0')}_SIZE`;
        const expected = parseInt(kv[key], 10);
        const actual = fs.statSync(path.join(packDir, chunkName(i))).size;
        if (actual !== expected) {
            console.warn(`Warning: ${chunkName(i)} size mismatch (expected ${expected}, got ${actual})`);
            sizeErrors++;
        }
    }
    if (sizeErrors > 0) {
        console.warn(`Warning: ${sizeErrors} chunk(s) have size mismatches — possible corruption.`);
        // In non-interactive mode (e.g. piped), continue anyway; caller can check exit code
    }

    // Reassemble
    const parts = [];
    for (let i = 1; i <= totalChunks; i++) {
        parts.push(fs.readFileSync(path.join(packDir, chunkName(i))));
    }
    const result = Buffer.concat(parts);
    fs.writeFileSync(outputFile, result);

    console.log('');
    if (result.length === originalSize) {
        console.log(`OK — reassembled ${outputFile} (${result.length} bytes, matches manifest)`);
    } else {
        console.error(`Warning: size mismatch — expected ${originalSize} bytes, got ${result.length} bytes`);
        process.exit(1);
    }
}

// ── CLI entry point ───────────────────────────────────────────────────────────

const [,, cmd, arg1, arg2] = process.argv;

if (cmd === 'pack') {
    if (!arg1) {
        console.error('Usage: node pack.js pack <input_file> [output_dir]');
        process.exit(1);
    }
    pack(arg1, arg2);
} else if (cmd === 'unpack') {
    if (!arg1) {
        console.error('Usage: node pack.js unpack <packed_dir> [output_file]');
        process.exit(1);
    }
    unpack(arg1, arg2);
} else {
    console.error('Usage:');
    console.error('  node pack.js pack   <input_file> [output_dir]');
    console.error('  node pack.js unpack <packed_dir> [output_file]');
    process.exit(1);
}
