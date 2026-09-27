// zlib deflate through CompressionStream (CLAUDE.md D85): its Adler-32
// checksum makes a truncated or altered link fail to decompress instead of
// yielding a different survey.

export class CompressionError extends Error {}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: GenericTransformStream) {
  const writer = (stream.writable as WritableStream<BufferSource>).getWriter();
  void writer.write(bytes).catch(() => undefined);
  void writer.close().catch(() => undefined);
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

export function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return pipe(bytes, new CompressionStream('deflate'));
}

export async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return await pipe(bytes, new DecompressionStream('deflate'));
  } catch {
    throw new CompressionError('The data is damaged or incomplete.');
  }
}
