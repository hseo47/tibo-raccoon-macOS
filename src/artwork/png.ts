const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function uint32(value: number): Uint8Array {
  return Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes);
  body.set(data, typeBytes.length);
  const output = new Uint8Array(12 + data.length);
  output.set(uint32(data.length));
  output.set(body, 4);
  output.set(uint32(crc32(body)), 8 + data.length);
  return output;
}

function storedDeflate(input: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [Uint8Array.of(0x78, 0x01)];
  for (let offset = 0; offset < input.length; offset += 65535) {
    const length = Math.min(65535, input.length - offset);
    const final = offset + length === input.length ? 1 : 0;
    const block = new Uint8Array(5 + length);
    block[0] = final;
    block[1] = length & 0xff;
    block[2] = length >>> 8;
    const complement = (~length) & 0xffff;
    block[3] = complement & 0xff;
    block[4] = complement >>> 8;
    block.set(input.subarray(offset, offset + length), 5);
    blocks.push(block);
  }
  blocks.push(uint32(adler32(input)));
  const total = blocks.reduce((size, block) => size + block.length, 0);
  const output = new Uint8Array(total);
  let position = 0;
  for (const block of blocks) {
    output.set(block, position);
    position += block.length;
  }
  return output;
}

export function encodeDeterministicPng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || rgba.length !== width * height * 4) {
    throw new RangeError('RGBA dimensions do not match');
  }
  const scanlines = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    scanlines[rowOffset] = 0;
    scanlines.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), rowOffset + 1);
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(uint32(width));
  ihdr.set(uint32(height), 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', storedDeflate(scanlines)), chunk('IEND', new Uint8Array())];
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
