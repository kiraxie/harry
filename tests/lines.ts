export const LINE_END_RE = /\r\n|\r|\n/;

export const lineAt = (text: string, offset: number): number =>
  text.slice(0, offset).split(LINE_END_RE).length;
