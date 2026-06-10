/* mammoth — type declarations for the browser bundle */
declare module 'mammoth' {
  interface Mammoth {
    convertToHtml: (input: Input, options?: Options) => Promise<Result>;
    extractRawText: (input: Input) => Promise<Result>;
    images: Images;
  }

  type Input = PathInput | BufferInput | ArrayBufferInput;

  interface PathInput {
    path: string;
  }

  interface BufferInput {
    buffer: Buffer;
  }

  interface ArrayBufferInput {
    arrayBuffer: ArrayBuffer;
  }

  interface Options {
    styleMap?: string | string[];
    includeEmbeddedStyleMap?: boolean;
    includeDefaultStyleMap?: boolean;
    convertImage?: unknown;
    ignoreEmptyParagraphs?: boolean;
    idPrefix?: string;
  }

  interface Result {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }

  interface Images {
    dataUri: unknown;
    imgElement: (fn: (image: unknown) => Promise<{ src: string }>) => unknown;
  }

  const mammoth: Mammoth;
  export default mammoth;
}
