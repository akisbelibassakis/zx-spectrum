// Lists the blocks of a TAP/TZX file and prints any BASIC program in it as text.
// Usage: node tools/list-basic.js <file.tap|file.tzx> [out.bas]
'use strict';
const fs = require('fs');
const path = require('path');
const { Tape } = require('../js/tape.js');

const TOKENS = ['RND', 'INKEY$', 'PI', 'FN ', 'POINT ', 'SCREEN$ ', 'ATTR ', 'AT ', 'TAB ', 'VAL$ ', 'CODE ', 'VAL ', 'LEN ',
  'SIN ', 'COS ', 'TAN ', 'ASN ', 'ACS ', 'ATN ', 'LN ', 'EXP ', 'INT ', 'SQR ', 'SGN ', 'ABS ', 'PEEK ', 'IN ', 'USR ',
  'STR$ ', 'CHR$ ', 'NOT ', 'BIN ', ' OR ', ' AND ', '<=', '>=', '<>', ' LINE ', ' THEN ', ' TO ', ' STEP ', ' DEF FN ',
  ' CAT ', ' FORMAT ', ' MOVE ', ' ERASE ', ' OPEN #', ' CLOSE #', ' MERGE ', ' VERIFY ', ' BEEP ', ' CIRCLE ', ' INK ',
  ' PAPER ', ' FLASH ', ' BRIGHT ', ' INVERSE ', ' OVER ', ' OUT ', ' LPRINT ', ' LLIST ', ' STOP ', ' READ ', ' DATA ',
  ' RESTORE ', ' NEW ', ' BORDER ', ' CONTINUE ', ' DIM ', ' REM ', ' FOR ', ' GO TO ', ' GO SUB ', ' INPUT ', ' LOAD ',
  ' LIST ', ' LET ', ' PAUSE ', ' NEXT ', ' POKE ', ' PRINT ', ' PLOT ', ' RUN ', ' SAVE ', ' RANDOMIZE ', ' IF ', ' CLS ',
  ' DRAW ', ' CLEAR ', ' RETURN ', ' COPY '];

function listBasic(prog) {
  const out = [];
  let i = 0;
  while (i + 4 <= prog.length) {
    const num = (prog[i] << 8) | prog[i + 1], len = prog[i + 2] | (prog[i + 3] << 8);
    if (num > 9999) break; // variables area follows the program
    let line = '', inRem = false, inStr = false;
    for (let k = i + 4; k < i + 4 + len && k < prog.length; k++) {
      const c = prog[k];
      if (c === 0x0d) break;
      if (c === 0x0e && !inRem && !inStr) { k += 5; continue; } // hidden 5-byte number
      if (c === 0x22) inStr = !inStr;
      if (c >= 0xa5 && !inStr) {
        const t = TOKENS[c - 0xa5];
        if (t === ' REM ') inRem = true;
        line += t;
      } else if (c >= 0x80 && c <= 0x8f) line += '{gfx' + (c - 0x80) + '}';
      else if (c >= 0x90 && c <= 0xa4) line += '{udg ' + String.fromCharCode(c - 0x90 + 65) + '}';
      else if (c < 0x20) line += '{' + c + '}';
      else if (c === 0x60) line += '£';
      else if (c === 0x7f) line += '©';
      else line += String.fromCharCode(c);
    }
    out.push(num + line.replace(/  +/g, ' ').replace(/^(?! )/, ' '));
    i += 4 + len;
  }
  return out.join('\n');
}

const file = process.argv[2];
const buf = new Uint8Array(fs.readFileSync(file));
const tape = /\.tzx$/i.test(file) ? Tape.fromTZX(buf) : Tape.fromTAP(buf);
let header = null, listing = '';
tape.blocks.forEach((b, n) => {
  console.log(`block ${n}: ${b.desc}${b.std ? '' : ' (non-standard)'}`);
  if (!b.data) return;
  const d = b.data;
  if (d[0] === 0 && d.length === 19) {
    header = { type: d[1], len: d[12] | (d[13] << 8), p1: d[14] | (d[15] << 8), p2: d[16] | (d[17] << 8) };
    console.log(`   type ${header.type}, length ${header.len}, ${header.type === 0 ? 'autostart line ' + header.p1 + ', program length ' + header.p2 : 'start address ' + header.p1}`);
  } else if (header && header.type === 0) {
    const prog = d.subarray(1, 1 + header.p2);
    listing += listBasic(prog) + '\n';
    header = null;
  }
});
const out = process.argv[3];
if (out) { fs.writeFileSync(out, listing); console.log('BASIC listing written to', out, '(' + listing.split('\n').length + ' lines)'); }
else process.stdout.write(listing);
