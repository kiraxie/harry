export type EdnValue = null | boolean | number | string | EdnValue[] | { [key: string]: EdnValue };

const DELIMITERS = new Set(["{", "}", "[", "]", '"', ";"]);

class Reader {
  private pos = 0;
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  fail(message: string): never {
    throw new Error(`EDN: ${message} at offset ${this.pos}`);
  }

  skip(): void {
    while (this.pos < this.text.length) {
      const c = this.text[this.pos];
      if (c === ";") {
        while (this.pos < this.text.length && this.text[this.pos] !== "\n") this.pos++;
      } else if (c === "," || /\s/.test(c)) {
        this.pos++;
      } else {
        return;
      }
    }
  }

  done(): boolean {
    this.skip();
    return this.pos >= this.text.length;
  }

  value(): EdnValue {
    this.skip();
    const c = this.text[this.pos];
    if (c === undefined) this.fail("unexpected end of input");
    if (c === "{") return this.map();
    if (c === "[") return this.vector();
    if (c === '"') return this.string();
    if (c === ":") {
      this.pos++;
      return this.token();
    }
    const token = this.token();
    if (token === "nil") return null;
    if (token === "true") return true;
    if (token === "false") return false;
    const n = Number(token);
    if (token === "" || Number.isNaN(n)) this.fail(`unsupported token "${token}"`);
    return n;
  }

  private token(): string {
    const start = this.pos;
    while (this.pos < this.text.length) {
      const c = this.text[this.pos];
      if (c === "," || /\s/.test(c) || DELIMITERS.has(c)) break;
      this.pos++;
    }
    return this.text.slice(start, this.pos);
  }

  private string(): string {
    this.pos++;
    let out = "";
    while (this.pos < this.text.length) {
      const c = this.text[this.pos++];
      if (c === '"') return out;
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = this.text[this.pos++];
      out += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e;
    }
    return this.fail("unterminated string");
  }

  private vector(): EdnValue[] {
    this.pos++;
    const items: EdnValue[] = [];
    for (;;) {
      this.skip();
      if (this.text[this.pos] === "]") {
        this.pos++;
        return items;
      }
      items.push(this.value());
    }
  }

  private map(): { [key: string]: EdnValue } {
    this.pos++;
    const out: { [key: string]: EdnValue } = {};
    for (;;) {
      this.skip();
      if (this.text[this.pos] === "}") {
        this.pos++;
        return out;
      }
      const key = this.value();
      if (typeof key !== "string") this.fail("map key is not a keyword or string");
      out[key] = this.value();
    }
  }
}

export function parseEdn(text: string): EdnValue {
  const reader = new Reader(text);
  const value = reader.value();
  if (!reader.done()) reader.fail("trailing input");
  return value;
}
