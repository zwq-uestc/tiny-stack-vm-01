// Tiny stack VM, make.fun's ISA v1: 32-bit wrapping integers, a 256-value
// data stack, 64 return addresses, 256 words of memory, input and output,
// ten traps with their own exit codes, a 1,000,000-step limit and a
// 65,536-byte output limit. Node 22, standard library only, no network.
//
// Run on the practice set:
//   mkdir -p out && MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Per-opcode table, indexed by opcode byte: immediate bytes, pops, pushes,
// packed as imm * 16 + pops * 4 + pushes + 1 (0 means no such opcode).
const T = new Uint8Array(84);
for (const [o, i, p, u] of [
  [0, 0, 0, 0], [1, 1, 0, 1], [2, 4, 0, 1], [3, 0, 1, 0], [4, 0, 1, 2],
  [5, 0, 2, 2], [6, 0, 2, 3], [7, 0, 3, 3],
  [16, 0, 2, 1], [17, 0, 2, 1], [18, 0, 2, 1], [19, 0, 2, 1], [20, 0, 2, 1],
  [21, 0, 2, 1], [22, 0, 2, 1], [23, 0, 1, 1], [24, 0, 2, 1], [25, 0, 2, 1],
  [26, 0, 2, 1], [27, 0, 1, 1], [28, 0, 2, 1], [29, 0, 2, 1], [30, 0, 2, 1],
  [32, 0, 2, 1], [33, 0, 2, 1], [34, 0, 2, 1],
  [48, 2, 0, 0], [49, 2, 1, 0], [50, 2, 1, 0], [51, 2, 0, 0], [52, 0, 0, 0],
  [64, 0, 1, 1], [65, 0, 2, 0],
  [80, 0, 1, 0], [81, 0, 1, 0], [82, 0, 0, 1], [83, 0, 1, 0],
] as const) T[o] = i * 16 + p * 4 + u + 1;

// Runs one program on its input: [the bytes it wrote, its exit code].
// A trap ends the program at once with the trap's code, keeping the
// output written before it; the trapping instruction writes nothing.
function run(p: Uint8Array, inp: Uint8Array): [Uint8Array, number] {
  const S = new Int32Array(256);
  const C = new Int32Array(64);
  const M = new Int32Array(256);
  const O = new Uint8Array(65536);
  const n = p.length;
  let sp = 0, cp = 0, ol = 0, pc = 0, ip = 0, st = 0;
  const end = (code: number): [Uint8Array, number] => [O.subarray(0, ol), code];
  for (;;) {
    if (st === 1000000) return end(10);
    if (pc < 0 || pc >= n) return end(9);
    const op = p[pc];
    const e = T[op];
    if (!e) return end(5);
    const imm = (e - 1) >> 4, pops = ((e - 1) >> 2) & 3, push = (e - 1) & 3;
    if (pc + imm >= n) return end(9);
    st++;
    const nx = pc + 1 + imm;
    if (sp < pops) return end(2);
    if (sp - pops + push > 256) return end(3);
    pc = nx;
    switch (op) {
      case 0:
        return end(0);
      case 1:
        S[sp++] = (p[nx - 1] << 24) >> 24;
        break;
      case 2:
        S[sp++] = p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24);
        break;
      case 3:
        sp--;
        break;
      case 4:
        S[sp] = S[sp - 1];
        sp++;
        break;
      case 5: {
        const t = S[sp - 1];
        S[sp - 1] = S[sp - 2];
        S[sp - 2] = t;
        break;
      }
      case 6:
        S[sp] = S[sp - 2];
        sp++;
        break;
      case 7: {
        const a = S[sp - 3];
        S[sp - 3] = S[sp - 2];
        S[sp - 2] = S[sp - 1];
        S[sp - 1] = a;
        break;
      }
      case 23:
        S[sp - 1] = (-S[sp - 1]) | 0;
        break;
      case 27:
        S[sp - 1] = ~S[sp - 1];
        break;
      case 16: case 17: case 18: case 19: case 20: case 21: case 22:
      case 24: case 25: case 26: case 28: case 29: case 30: case 32: case 33: case 34: {
        const b = S[sp - 1], a = S[sp - 2];
        let r = 0;
        if (op === 16) r = (a + b) | 0;
        else if (op === 17) r = (a - b) | 0;
        else if (op === 18) r = Math.imul(a, b);
        else if (op === 19) {
          if (b === 0) return end(4);
          r = (a / b) | 0;
        } else if (op === 20) {
          // MOD: a % -1 is 0 (or -0) in JS for every a, so no special case
          // is needed for INT_MIN % -1; |0 normalises -0 to 0.
          if (b === 0) return end(4);
          r = (a % b) | 0;
        } else if (op === 21) {
          if (b === 0) return end(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 22) {
          if (b === 0) return end(4);
          r = ((a >>> 0) % (b >>> 0)) | 0;
        } else if (op === 24) r = a & b;
        else if (op === 25) r = a | b;
        else if (op === 26) r = a ^ b;
        else if (op === 28) r = a << (b & 31);
        else if (op === 29) r = a >> (b & 31);
        else if (op === 30) r = (a >>> (b & 31)) | 0;
        else if (op === 32) r = a === b ? 1 : 0;
        else if (op === 33) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        sp -= 2;
        S[sp++] = r;
        break;
      }
      case 48: case 49: case 50: {
        const rel = ((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16;
        let take = op === 48;
        if (op !== 48) {
          const v = S[--sp];
          take = op === 49 ? v === 0 : v !== 0;
        }
        if (take) pc = nx + rel;
        break;
      }
      case 51:
        if (cp === 64) return end(7);
        C[cp++] = nx;
        pc = p[nx - 2] | (p[nx - 1] << 8);
        break;
      case 52:
        if (cp === 0) return end(8);
        pc = C[--cp];
        break;
      case 64: {
        const a = S[sp - 1];
        if (a < 0 || a >= 256) return end(6);
        S[sp - 1] = M[a];
        break;
      }
      case 65: {
        const a = S[sp - 1], v = S[sp - 2];
        if (a < 0 || a >= 256) return end(6);
        sp -= 2;
        M[a] = v;
        break;
      }
      case 80: {
        const s = String(S[sp - 1]);
        if (ol + s.length > 65536) return end(11);
        sp--;
        for (let i = 0; i < s.length; i++) O[ol++] = s.charCodeAt(i);
        break;
      }
      case 81:
        if (ol + 1 > 65536) return end(11);
        O[ol++] = S[--sp] & 255;
        break;
      case 82:
        S[sp++] = ip < inp.length ? inp[ip++] : -1;
        break;
      case 83:
        return end(S[--sp] & 255);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const [out, code] = run(
    new Uint8Array(readFileSync(join(I, id, 'program.bin'))),
    new Uint8Array(readFileSync(join(I, id, 'input.bin'))),
  );
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), out);
  writeFileSync(join(O, id, 'exit.txt'), `${code}\n`);
}
