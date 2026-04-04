declare module 'md-to-pdf' {
  export interface MdToPdfInput {
    content?: string;
    path?: string;
  }

  export interface MdToPdfOptions {
    pdf_options?: {
      format?: string;
      margin?: {
        top?: string;
        right?: string;
        bottom?: string;
        left?: string;
      };
      printBackground?: boolean;
    };
    launch_options?: {
      args?: string[];
    };
  }

  export interface MdToPdfResult {
    content?: Buffer | Uint8Array | string | null;
  }

  export function mdToPdf(
    input: MdToPdfInput,
    options?: MdToPdfOptions,
  ): Promise<MdToPdfResult | undefined>;
}
