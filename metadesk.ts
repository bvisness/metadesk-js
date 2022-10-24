/*
 * This file implements a parser for the Metadesk format by Dion Systems.
 *
 * Metadesk is a flexible, human-friendly data description format with a simple, uniform structure.
 * This simple structure is paired with a rich helper library that makes it easy to manipulate this
 * structure. Metadesk is richer than JSON, friendlier than XML, less confusing than YAML, and
 * easier to work with than all of the above.
 * 
 * This file serves as a reference implementation for a Metadesk parser. Its goal is to be a simple
 * and clear example of a Metadesk parser, not to be the most efficient. However, since Metadesk's
 * grammar is unambiguous and this implementation is simple, efficiency should not be a
 * significant problem.
 * 
 * TODO:
 * 
 * General advice:
 * - Consume all whitespace before handing off to another function. Whitespace is important; only
 *   consume it when you know you can.
 * Remove TokenGroup in favor of simple constants
 * Allow comments in nearly any whitespace, and make aggregation of comments easy.
 * - Weird nuance: comments could sometimes do "double duty", either "after" a node or "before" the
 *   next. How to handle this?
 * Spec out Unicode handling.
 * 
 * =========
 *  Grammar
 * =========
 * 
 * This is a complete grammar for Metadesk, organized in such a way that it can reasonably be
 * followed to make a recursive descent parser. It does not attempt to validate everything about
 * the language; some things are best validated after parsing.
 * 
 * First, definitions of terminals / tokens:
 * 
 *   LINE-COMMENT:  Line comments start with a "//" and continue up to (but do not include) a CR
 *                  or LF.
 *   BLOCK-COMMENT: Block comments start with a "/*" and continue until a "*​/". Block comments can
 *                  be nested, so all pairs of "/*" and "*​/" must be balanced. If JavaScript did
 *                  this, then I wouldn't have to use zero-width spaces in this comment every time
 *                  I write "*​/"!
 *   SPACE:         " ", "\r", "\t", "\f", or "\v". Equivalent to C's isspace, excluding newlines.
 *   NEWLINE:       "\n". This grammar does not recognize CRLF as a newline, but will handle CRLF
 *                  just fine regardless.
 *   STRING:        Strings can be delimited using single quotes, double quotes, or backticks. A
 *                  string can use a single delimiter (e.g. "foo", 'bar', or `baz`), in which case
 *                  newlines are not allowed, or triple delimiters (e.g. """foo""", '''bar''', or
 *                  ```baz```), in which case newlines are permitted. In either case, characters
 *                  can be escaped with a backslash as in C.
 *   IDENTIFIER:    Identifiers follow C identifier rules, satisfying the regex
 *                  "[a-zA-Z_][a-zA-Z0-9_]*".
 *   NUMERIC:       Numerics follow the JSON grammar for numbers, satisfying the regex
 *                  "-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?".
 *   SYMBOL:        Runs of the following symbols: ~ ! $ % ^ & * - = + < . > / ? |. These symbols
 *                  are not used by the Metadesk language and are therefore available for users.
 *                  Examples: "+", "->", "^.^", "---".
 *   SEPARATOR:     "," or ";". Used to separate children within explicitly-delimited sets or end
 *                  implicitly-delimited sets.
 * 
 * Now, the grammar, in ABNF notation:
 * 
 *   comment            = LINE-COMMENT / BLOCK-COMMENT
 *   whitespace-line    = 1*(SPACE / comment)
 *   whitespace-all     = 1*(SPACE / NEWLINE / comment)
 * 
 *   label              = IDENTIFIER / NUMERIC / STRING / SYMBOL
 * 
 *   node               = [whitespace-all] [tag-list] (named-node / anonymous-node)
 *   named-node         = label [":" [whitespace-line] [NEWLINE] [whitespace-line] (
 *                          explicit-list / implicit-list
 *                        )]
 *   anonymous-node     = explicit-list
 * 
 *   tag-list           = "@" label [explicit-list] [whitespace-all tag-list]
 * 
 *   explicit-list      = ("(" / "[" / "{") explicit-children (")" / "]" / "}")
 *   explicit-children  = [whitespace-all] [
 *                          node
 *                          [whitespace-all] [SEPARATOR] [whitespace-all] 
 *                          [explicit-children]
 *                        ]
 *   implicit-list      = implicit-children (SEPARATOR / NEWLINE)
 *   implicit-children  = [whitespace-line] node [whitespace-line implicit-children]
 * 
 *   root               = explicit-children ; The file itself is parsed as an explicit list of
 *                                            children, but delimited by the end of the file.
 * 
 * Some general notes about this grammar:
 * 
 *   - Comments are included in this grammar because Metadesk implementations are encouraged to attach pre/post comments to nodes. This requires implementations to keep comments around throughout the parse.
 *   - Yes, there's a lot of whitespace in here. Parts of metadesk are whitespace-sensitive, so you can't just throw whitespace away. However, whitespace has been carefully placed in the grammar where it makes sense to handle it during parsing. Even with whitespace, the grammar is unambiguous and can be parsed in a single pass without backtracking.
 * 
 */

const DEBUG = false;

enum NodeKind {
    Nil,
    
    // Generated by parser
    File,
    ErrorMarker,
    
    // Parsed from user Metadesk code
    Main,
    Tag,
    
    // // NOTE(rjf): User-created data structures
    // List,
    // Reference,
}

interface Node {
    kind: NodeKind,
    flags: NodeFlags,
    string: string,
    rawString: string,
    offset: number,

    next: Node | undefined,
    prev: Node | undefined,
    parent: Node | undefined,

    children: Node[],
    tags: Node[],
}

function makeNode(kind: NodeKind, str: string, rawStr: string, offset: number): Node {
    return {
        kind: kind,
        flags: NodeFlags.None,
        string: str,
        rawString: rawStr,
        offset: offset,

        next: undefined,
        prev: undefined,
        parent: undefined,

        children: [],
        tags: [],
    };
}

// TODO: This sucks and isn't universally useful. Error messages should actually show the source
// as it appears. Other things should not. I dunno.
function sanitize(str: string): string {
    str = str.replace(/\n/g, "\\n");
    str = str.replace(/\t/g, "\\t");
    return str;
}

export class ParseResult {
    node: Node | undefined
    #ctx: ParseContext

    constructor(node: Node | undefined, ctx: ParseContext) {
        this.node = node;
        this.#ctx = ctx;
    }

    get errors() {
        return this.#ctx.errors;
    }

    fancyErrors() {
        return this.errors.map(err => {
            const amt = 20;
            const before = sanitize(this.#ctx.source.slice(err.offset - amt, err.offset));
            const promblem = sanitize(this.#ctx.source.slice(err.offset, err.offset + 1));
            const after = sanitize(this.#ctx.source.slice(err.offset + 1, err.offset + amt));
            const pad = " ".repeat(before.length);
            return `ERROR: ${err.message}
 |
 | ${before}${promblem}${after}
 | ${pad}^
 |
`
        });
    }
}

export function parse(source: string): ParseResult {
    const ctx = new ParseContext(source);
    
    const root = makeNode(NodeKind.File, "", source, 0);
    root.children = _parseExplicitChildren(ctx)

    return new ParseResult(root, ctx);
}

enum TokenKind {
    Invalid = 0,

    Identifier      = 1 << 0,
    Numeric         = 1 << 1,
    StringLiteral   = 1 << 2,
    Symbol          = 1 << 3,
    Reserved        = 1 << 4,
    Comment         = 1 << 5,
    Whitespace      = 1 << 6,
    Newline         = 1 << 7,

    BrokenComment       = 1 << 8,
    BrokenStringLiteral = 1 << 9,
    BadCharacter        = 1 << 10,
}

const 

enum TokenGroup {
    Whitespace  = TokenKind.Whitespace | TokenKind.Newline,
    Irregular   = TokenKind.Comment | TokenKind.Whitespace | TokenKind.Newline, // TODO: I added newline. Is this a problem?
    Regular     = ~Irregular,
    Label       = TokenKind.Identifier
                    | TokenKind.Numeric
                    | TokenKind.StringLiteral
                    | TokenKind.Symbol,
    Error       = TokenKind.BrokenComment
                    | TokenKind.BrokenStringLiteral
                    | TokenKind.BadCharacter,
    
    All = ~0,
}

export function tokenKindName(kind: TokenKind) {
    if (kind === TokenKind.Invalid) {
        return "Invalid";
    }
    
    const names: string[] = [];
    if (kind & TokenKind.Identifier) {
        names.push("Identifier");
    }
    if (kind & TokenKind.Numeric) {
        names.push("Numeric");
    }
    if (kind & TokenKind.StringLiteral) {
        names.push("StringLiteral");
    }
    if (kind & TokenKind.Symbol) {
        names.push("Symbol");
    }
    if (kind & TokenKind.Reserved) {
        names.push("Reserved");
    }
    if (kind & TokenKind.Comment) {
        names.push("Comment");
    }
    if (kind & TokenKind.Whitespace) {
        names.push("Whitespace");
    }
    if (kind & TokenKind.Newline) {
        names.push("Newline");
    }
    if (kind & TokenKind.BrokenComment) {
        names.push("BrokenComment");
    }
    if (kind & TokenKind.BrokenStringLiteral) {
        names.push("BrokenStringLiteral");
    }
    if (kind & TokenKind.BadCharacter) {
        names.push("BadCharacter");
    }

    return names.join(', ');
}

enum NodeFlags {
    None = 0,

    HasParenLeft    = 1 << 0,
    HasParenRight   = 1 << 1,
    HasBracketLeft  = 1 << 2,
    HasBracketRight = 1 << 3,
    HasBraceLeft    = 1 << 4,
    HasBraceRight   = 1 << 5,

    MaskSetDelimiters = 0x3F << 0,

    IsBeforeSemicolon   = 1 << 6,
    IsAfterSemicolon    = 1 << 7,
    IsBeforeComma       = 1 << 8,
    IsAfterComma        = 1 << 9,

    MaskSeparators = 0xF << 6,

    StringSingleQuote   = 1 << 10,
    StringDoubleQuote   = 1 << 11,
    StringTick          = 1 << 12,
    StringTriplet       = 1 << 13,
    
    MaskStringDelimiters = 0xF << 10,
    
    Numeric         = 1 << 14,
    Identifier      = 1 << 15,
    StringLiteral   = 1 << 16,
    Symbol          = 1 << 17,
    
    MaskLabelKind = 0xF << 14,
}

export class Token {
    kind: TokenKind
    // TODO: flags?
    string: string
    rawString: string
    remaining: string

    constructor(kind: TokenKind, string: string, rawString: string, remaining: string) {
        this.kind = kind;
        this.string = string;
        this.rawString = rawString;
        this.remaining = remaining;
    }

    toString(): string {
        let val = sanitize(this.rawString);
        const name = tokenKindName(this.kind);
        if (/^ +$/.test(val)) {
            val = `"${val}"`
        }
        return `${val} (${name})`;
    }
}

export function getToken(string: string): Token | undefined {
    if (string === "") {
        return undefined;
    }

    let kind = TokenKind.Invalid, flags = NodeFlags.None;
    let len = 0;
    let skip = 0, chop = 0;

    // Scan forward, updating len, until the condition is false.
    // string[len] will be at the first non-matching char.
    function scan(charMatches: (char: string) => boolean) {
        for (; len < string.length; len++) {
            if (!charMatches(string[len])) {
                break;
            }
        }
    }

    switch (string[0]) {
        // Whitespace parsing
        case "\n": {
            kind = TokenKind.Newline;
            len += 1;
        } break;
        case " ": case "\r": case "\t": case "\f": case "\v": {
            kind = TokenKind.Whitespace;
            len += 1;
            scan(c => [" ", "\r", "\t", "\f", "\v"].includes(c));
        } break;

        // Comment parsing
        case "/": {
            if (string.length <= 1) {
                // TODO: goto symbol_lex ???!!!?
                break;
            }

            if (string[1] === "/") {
                // Trim off the first "//"
                skip = 2;
                len += 2;
                kind = TokenKind.Comment;
                scan(c => !["\n", "\r"].includes(c));
            } else if (string[1] == "*") {
                // Trim off the first "/*"
                skip = 2;
                len += 2;
                kind = TokenKind.BrokenComment;
                let commentDepth = 1;
                for (; len < string.length && commentDepth > 0; len += 1) {
                    if (len + 1 < string.length) {
                        if (string[len] === "*" && string[len+1] === "/") {
                            len += 1;
                            commentDepth -= 1;
                        } else if (string[len] === "/" && string[len+1] === "*") {
                            len += 1;
                            commentDepth += 1;
                        }
                    }
                }
                if (commentDepth === 0) {
                    kind = TokenKind.Comment;
                    chop = 2;
                }
            }
        } break;

        // Strings
        case "\"": case "'": case "`": {
            kind = TokenKind.BrokenStringLiteral;

            // Determine delimiter setup (which delimiter, is it a triplet)
            const delim = string[0];
            const isTriplet = string.length >= 3 && string[1] === delim && string[2] === delim;

            if (isTriplet) {
                // Lex a triple-delimited string
                skip = 3;
                len += 3;
                let consecutiveDelims = 0;
                for (; len < string.length; len++) {
                    if (string[len] === delim) {
                        consecutiveDelims += 1;
                        if (consecutiveDelims === 3) {
                            len += 1; // The last quote doesn't get captured without this because the loop increment doesn't run
                            chop = 3;
                            kind = TokenKind.StringLiteral;
                            break;
                        }
                    } else {
                        consecutiveDelims = 0;

                        // escaping characters in string literals
                        // (it seems that only the current delimiter can be escaped?)
                        if (string[len] === "\\" && (string[len+1] === delim || string[len+1] === "\\")) {
                            len += 1; // extra bump to skip the char after the backslash
                        }
                    }
                }
            } else {
                // Lex a single-delimited string
                skip = 1;
                len += 1;
                for (; len < string.length; len++) {
                    // Close condition
                    if (string[len] === delim) {
                        chop = 1;
                        len += 1;
                        kind = TokenKind.StringLiteral;
                        break;
                    }

                    // Fail condition
                    if (string[len] === "\n") {
                        break;
                    }

                    // escaping characters in string literals
                    // (it seems that only the current delimiter can be escaped?)
                    if (string[len] === "\\" && (string[len+1] === delim || string[len+1] === "\\")) {
                        len += 1; // extra bump to skip the char after the backslash
                    }
                }
            }

            flags |= NodeFlags.StringLiteral;
            switch (delim) {
                case "'":  flags |= NodeFlags.StringSingleQuote; break;
                case "\"": flags |= NodeFlags.StringDoubleQuote; break;
                case "`":  flags |= NodeFlags.StringTick; break;
            }
            if (isTriplet) {
                flags |= NodeFlags.StringTriplet;
            }
        } break;

        // Identifiers, numbers, symbols
        default: {
            const identifierMatch = string.match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
            const numericMatch = string.match(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/);

            if (identifierMatch) {
                flags |= NodeFlags.Identifier;
                kind = TokenKind.Identifier;
                len += identifierMatch[0].length;
            } else if (numericMatch) {
                flags |= NodeFlags.Numeric;
                kind = TokenKind.Numeric;
                len += numericMatch[0].length;
            } else if (charIsUnreservedSymbol(string[0])) {
                flags |= NodeFlags.Symbol;
                kind = TokenKind.Symbol;
                len += 1;
                scan(c => charIsUnreservedSymbol(c));
            } else if (charIsReservedSymbol(string[0])) {
                kind = TokenKind.Reserved;
                len += 1;
            } else {
                kind = TokenKind.BadCharacter;
                len += 1;
            }
        } break;
    }

    return new Token(kind, string.slice(skip, len-chop), string.slice(0, len), string.slice(len));
}

function charIsUnreservedSymbol(c: string): boolean {
    return "~!$%^&*-=+<.>/?|".includes(c);
}

function charIsReservedSymbol(c: string): boolean {
    return "{}()\\[]#,;:@".includes(c);
}

interface Error {
    message: string,
    offset: number,
}

class ParseContext {
    #source: string;
    #remaining: string;
    #last: Token | undefined;
    #errors: Error[];

    constructor(source: string) {
        this.#source = source;
        this.#remaining = source;
        this.#errors = [];
    }

    check(
        kind: TokenKind | TokenGroup = TokenGroup.All,
        cond: (token: Token) => boolean = () => true,
    ): Token | undefined {
        const token = getToken(this.#remaining);
        if (token && (token.kind & kind) && cond(token)) {
            return token;
        } else {
            return undefined;
        }
    }

    consume(
        kind: TokenKind | TokenGroup = TokenGroup.All,
        cond: (token: Token) => boolean = () => true,
    ): Token | undefined {
        const token = this.check(kind, cond);
        if (token) {
            this.#remaining = token.remaining;
            this.#last = token;
        }
        return token;
    }

    consumeAll(
        kind: TokenKind | TokenGroup = TokenGroup.All,
        cond: (token: Token) => boolean = () => true,
    ): Token[] {
        const tokens: Token[] = [];
        for (const _ of forever()) {
            const token = this.consume(kind, cond);
            if (!token) {
                break;
            }
            tokens.push(token);
        }
        return tokens;
    }

    done(): boolean {
        return !this.check();
    }

    error(msg: string, offset: number = this.offset) {
        this.debug(`ERROR! ${msg}`)
        this.#errors.push({
            message: msg,
            offset: offset,
        });
    }

    debug(msg: string) {
        if (!DEBUG) return;
        console.log({
            msg,
            remaining: this.#remaining.slice(0, Math.min(30, this.#remaining.length)),
        });
    }

    get source(): string {
        return this.#source;
    }

    get last(): Token | undefined {
        return this.#last;
    }

    get offset(): number {
        return this.#source.length - this.#remaining.length;
    }

    get errors(): Error[] {
        return this.#errors;
    }
}

/**
 * Grammar:
 * 
 *     node           = [whitespace-all] [tag-list] (named-node / anonymous-node)
 *     named-node     = label [":" [whitespace-line] [NEWLINE] [whitespace-line] (
 *                        explicit-list / implicit-list
 *                      )]
 *     anonymous-node = explicit-list
 * 
 * This function parses an entire `node`.
 */
export function _parseNode(ctx: ParseContext): Node | undefined {
    ctx.debug("parseNode");

    const startOffset = ctx.offset;

    const node = makeNode(NodeKind.Main, "", "", ctx.offset);

    const preamble = ctx.consumeAll(TokenGroup.Irregular);
    // TODO: Grab comments and assemble the "pre-comment" stuff

    node.tags = _parseTagList(ctx);
    ctx.debug(`got ${node.tags.length} tags`);

    // Check if we should break into the case where it's just an explicit-list
    const explicitOpener = ctx.check(TokenKind.Reserved, t => "([{".includes(t.string));
    if (explicitOpener) {
        // Anonymous node (no string, just children)
        ctx.debug("node is anonymous");
        const [children, flags] = _parseExplicitList(ctx);
        node.children = children!;
        node.flags |= flags;
    } else {
        // Named node
        const label = ctx.consume(TokenGroup.Label);
        if (label) {
            node.string = label.string;
            ctx.debug(`node is named: ${node.string}`);
            
            const colon = ctx.consume(TokenKind.Reserved, t => t.string === ":");
            if (colon) {
                // Node has children

                // Optional whitespace / single newline before any children begin
                ctx.consumeAll(TokenKind.Whitespace);
                ctx.consume(TokenKind.Newline);

                const opener = ctx.check(TokenKind.Reserved, t => "([{".includes(t.string));
                if (opener) {
                    const [children, flags] = _parseExplicitList(ctx);
                    node.children = children!;
                    node.flags |= flags;
                } else {
                    node.children = _parseImplicitList(ctx);
                }
            }
        } else {
            ctx.error(`expected a valid node label, but got "${sanitize(ctx.check()?.string ?? "end of file")}" instead`);
            return undefined;
        }
    }

    // TODO: post-comment stuff?

    const endOffset = ctx.offset;
    node.rawString = ctx.source.slice(startOffset, endOffset);

    return node;
}

/**
 * Grammar:
 * 
 *     tag-list = "@" label [explicit-list] [whitespace-all tag-list]
 * 
 * After parsing, this function verifies that the list of children used parentheses (the only valid
 * delimiter for tag children).
 */
export function _parseTagList(ctx: ParseContext): Node[] {
    ctx.debug("parseTagList");

    const result: Node[] = [];

    for (const _ of forever()) {
        const at = ctx.consume(TokenKind.Reserved, t => t.string === "@");
        if (!at) {
            break;
        }

        const label = ctx.consume(TokenGroup.Label);
        if (!label) {
            ctx.error(`"${sanitize(ctx.last?.rawString ?? "<undefined>")}" is not a proper tag label`);
            break;
        }

        ctx.debug(`tag is named: ${label.string}`);

        const tagNode = makeNode(NodeKind.Tag, label.string, label.rawString, ctx.offset);
        const tagChildrenOffset = ctx.offset;
        const [tagChildren, tagFlags] = _parseExplicitList(ctx);
        tagNode.flags |= tagFlags;
        
        const childrenAreParenthesized = tagNode.flags&NodeFlags.HasParenLeft && tagNode.flags&NodeFlags.HasParenRight;
        if (tagChildren !== undefined && !childrenAreParenthesized) {
            ctx.error("tag children can only be delimited using parentheses", tagChildrenOffset);
        }
        tagNode.children = tagChildren ?? [];

        result.push(tagNode);

        ctx.consumeAll(TokenGroup.Whitespace);
    }

    return result;
}

/**
 * Grammar:
 * 
 *     explicit-list = ("(" / "[" / "{") explicit-children (")" / "]" / "}")
 * 
 * Note that, while the grammar allows for any combination of opening and closing delimiters, some
 * combinations are forbidden and will be validated separately.
 */
function _parseExplicitList(ctx: ParseContext): [Node[] | undefined, NodeFlags] {
    ctx.debug("parseExplicitList");

    let parentFlags: NodeFlags = 0;

    const openerOffset = ctx.offset;
    const opener = ctx.consume(TokenKind.Reserved, t => "([{".includes(t.string));
    if (!opener) {
        ctx.debug("no list")
        return [undefined, 0];
    }
    switch (opener.string) {
        case "(": parentFlags |= NodeFlags.HasParenLeft; break;
        case "[": parentFlags |= NodeFlags.HasBracketLeft; break;
        case "{": parentFlags |= NodeFlags.HasBraceLeft; break;
    }
    
    const children = _parseExplicitChildren(ctx);

    const closer = ctx.consume(TokenKind.Reserved, t => ")]}".includes(t.string));

    const isBraced = opener.string === "{" && closer?.string === "}";
    const isBracketed = opener && closer && (
        "([".includes(opener.string)
        && ")]".includes(closer.string)
    );
    if (!(isBraced || isBracketed)) {
        ctx.error(`"${opener.string}" and "${closer?.string}" cannot be used together`, openerOffset);
    }

    switch (closer?.string) {
        case ")": parentFlags |= NodeFlags.HasParenRight; break;
        case "]": parentFlags |= NodeFlags.HasBracketRight; break;
        case "}": parentFlags |= NodeFlags.HasBraceRight; break;
    }

    return [children, parentFlags];
}

/**
 * Grammar:
 * 
 *     explicit-children = [whitespace-all] [
 *                           node
 *                           [whitespace-all] [SEPARATOR] [whitespace-all] 
 *                           [explicit-children]
 *                         ]
 * 
 * Since this part of the grammar only occurs within `explicit-list` and `file`, this function will
 * exit when it sees either a closing delimiter or the end of the token stream. It will not consume
 * the final delimiter, if any, so that `_parseExplicitList` can consume it.
 */
function _parseExplicitChildren(ctx: ParseContext): Node[] {
    const result: Node[] = [];

    // Early out if empty
    ctx.consumeAll(TokenGroup.Whitespace);
    const endDelimiter = ctx.check(TokenKind.Reserved, t => ")]}".includes(t.string));
    if (endDelimiter || ctx.done()) {
        return result;
    }

    let nextNodeFlags: NodeFlags = 0;
    for (const _ of forever()) {
        ctx.consumeAll(TokenGroup.Whitespace);

        const node = _parseNode(ctx);
        if (!node) {
            break;
        }
        node.flags |= nextNodeFlags;
        nextNodeFlags = 0;
        result.push(node); // this is JS, so we can continue to modify node after pushing it

        ctx.consumeAll(TokenGroup.Irregular);

        const separator = ctx.consume(TokenKind.Reserved, t => ",;".includes(t.string));
        if (separator) {
            switch (separator.string) {
                case ",": {
                    node.flags |= NodeFlags.IsBeforeComma;
                    nextNodeFlags |= NodeFlags.IsAfterComma;
                } break;
                case ";": {
                    node.flags |= NodeFlags.IsBeforeSemicolon;
                    nextNodeFlags |= NodeFlags.IsAfterSemicolon;
                } break;
                // default: {
                //     ctx.error(`unexpected character ${separator.string} in a list of nodes`);
                // } break;
            }
        }

        // TODO: This might eat comments that should be "before" a subsequent node.
        ctx.consumeAll(TokenGroup.Irregular);

        // Check if we need to bail
        const endDelimiter = ctx.check(TokenKind.Reserved, t => ")]}".includes(t.string));
        if (endDelimiter || ctx.done()) {
            break;
        }
    }

    return result;
}

/**
 * Grammar:
 * 
 *     implicit-list     = implicit-children (SEPARATOR / NEWLINE)
 *     implicit-children = [whitespace-line] node [whitespace-line implicit-children]
 * 
 * We parse the two together in a single function for simplicity.
 */
function _parseImplicitList(ctx: ParseContext): Node[] {
    ctx.debug("parseImplicitList");

    const result: Node[] = [];
    for (const _ of forever()) {
        ctx.consumeAll(TokenKind.Whitespace);

        const node = _parseNode(ctx);
        if (!node) {
            ctx.error("expected a node");
            break;
        }
        result.push(node);

        const nextIsSeparator = ctx.check(TokenKind.Reserved, t => ",;".includes(t.string));
        const nextIsNewline = ctx.check(TokenKind.Newline);
        if (nextIsSeparator || nextIsNewline) {
            ctx.consume(); // This is really part of processing `implicit-list`
            break;
        }

        const whitespaceBeforeNext = ctx.consumeAll(TokenKind.Whitespace);
        if (whitespaceBeforeNext.length === 0) {
            ctx.error("whitespace is required before the next node in the list");
            break;
        }
    }

    return result;
}

export enum GenerateFlags {
    Tags         = 1 << 0,
    TagArguments = 1 << 1,
    Children     = 1 << 2,
    Comments     = 1 << 3,
    NodeKind     = 1 << 4,
    NodeFlags    = 1 << 5,
    Location     = 1 << 6,
    
    Tree = (
        Tags
        | TagArguments
        | Children
    ),
    All = 0xffffffff,
}

export function debugDumpFromNode(
    node: Node,
    indent: number,
    indentString: string,
    flags: GenerateFlags,
): string {
    let out = '';

    // TODO: previous comment

    function printIndent() {
        for (let i = 0; i < indent; i++) {
            out += indentString;
        }
    }

    // tags
    if (flags & GenerateFlags.Tags) {
        for (const tag of node.tags) {
            printIndent();
            out += `@${tag.string}`;
            if (flags & GenerateFlags.TagArguments && tag.children.length > 0) {
                const tagArgIndent = indent + 1 + tag.string.length + 1;
                out += "(";
                for (const [i, child] of tag.children.entries()) {
                    if (i > 0) {
                        out += ",\n";
                    }
                    let childIndent = i === 0 ? 0 : tagArgIndent;
                    out += debugDumpFromNode(child, childIndent, " ", flags);
                }
                out += ")\n";
            } else {
                out += "\n";
            }
        }
    }

    // node kind
    if (flags & GenerateFlags.NodeKind) {
        printIndent();
        out += `// kind: "${node.kind}"\n`; // TODO: stringFromNodeKind
    }

    // node flags
    if (flags & GenerateFlags.NodeFlags) {
        printIndent();
        const flagsStr = stringListFromNodeFlags(node.flags).join("|");
        out += `// flags: "${flagsStr}"\n`;
    }

    // location
    // TODO

    // name of node
    if (node.string) {
        printIndent();
        if (node.kind === NodeKind.File) {
            out += `\`${node.string}\``;
        } else {
            out += node.string; // TODO: in ryan's code, this is the raw string instead??
        }
    }

    // children list
    if (flags & GenerateFlags.Children && node.children.length > 0) {
        if (node.string) {
            out += ":\n";
        }
        printIndent();
        out += "{\n";
        for (const child of node.children) {
            out += debugDumpFromNode(child, indent + 1, indentString, flags);
            out += ",\n";
        }
        printIndent();
        out += "}";
    }

    // next comment
    // TODO

    return out;
}

function stringListFromNodeFlags(flags: NodeFlags): string[] {
    return ["flag", "lol"]; // TODO
}

function* forever() {
    for (let i = 0; i < 10000; i++) {
        yield true;
    }
    throw new Error("a loop ran on too long");
};
