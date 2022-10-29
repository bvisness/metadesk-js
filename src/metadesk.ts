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
 * Spec out Unicode handling.
 * Real tests
 * Line wrap everything
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
 *                  be nested, so all pairs of "/*" and "*​/" must be balanced. (If JavaScript did
 *                  this, then I wouldn't have to use zero-width spaces in this comment every time
 *                  I write "*​/"!)
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
 *   NUMERIC:       Numerics start with a digit and then can include any combination of letters,
 *                  digits, ".", and "_". Also, the characters "-" and "+" are allowed as long as
 *                  they follow a lowercase or uppercase E.
 *                  Examples: 1, 3.14, 0xDEADBEEF.
 *                  Regex: "-?[0-9]([eE][+-]|[a-zA-Z0-9._])*"
 *   SYMBOL:        Runs of the following symbols: ~ ! $ % ^ & * - = + < . > / ? |. These symbols
 *                  are not used by the Metadesk language and are therefore available for users.
 *                  Examples: "+", "->", "^.^", "---".
 *   SEPARATOR:     "," or ";". Used to separate children within explicitly-delimited sets or end
 *                  implicitly-delimited sets.
 * 
 * Now, the grammar, in ABNF notation:
 * 
 *   label              = IDENTIFIER / NUMERIC / STRING / SYMBOL
 *   comment            = LINE-COMMENT / BLOCK-COMMENT
 *   whitespace-line    = 1*(SPACE / comment)
 *   whitespace-all     = 1*(SPACE / NEWLINE / comment)
 * 
 *   ; Whitespace including at most one newline can appear in multiple places in the definition of
 *   ; a node. Two newlines is not allowed because it causes too much visual separation.
 *   whitespace-node    = whitespace-line [NEWLINE] [whitespace-line]
 * 
 *   node               = [tag-list [whitespace-all]] (named-node / anonymous-node)
 *   named-node         = label [":" [whitespace-node] (explicit-list / implicit-list)]
 *   anonymous-node     = explicit-list
 * 
 *   tag-list           = "@" label [explicit-list] [whitespace-all] [tag-list]
 * 
 *   explicit-list      = ("(" / "[" / "{") explicit-children (")" / "]" / "}")
 *   explicit-children  = [whitespace-all] [node [whitespace-all] [SEPARATOR] explicit-children]
 *   implicit-list      = implicit-children (SEPARATOR / NEWLINE)
 *   implicit-children  = node [whitespace-line] [implicit-children]
 * 
 *   root               = explicit-children ; The source itself is parsed as an explicit list of
 *                                            nodes, but "delimited" by the end of the file.
 * 
 * Some general notes about this grammar:
 * 
 *   - Comments are included in this grammar because Metadesk implementations are encouraged to attach pre/post comments to nodes. This requires implementations to keep comments around throughout the parse.
 *   - Yes, there's a lot of whitespace in here. Parts of metadesk are whitespace-sensitive, so you can't just throw whitespace away. However, whitespace has been carefully placed in the grammar where it makes sense to handle it during parsing. Even with whitespace, the grammar is unambiguous and can be parsed in a single pass without backtracking.
 * 
 */

const DEBUG = false;

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

const AllTokens = ~0;
const Label = (
    TokenKind.Identifier
    | TokenKind.Numeric
    | TokenKind.StringLiteral
    | TokenKind.Symbol
);
const WhitespaceLine = TokenKind.Whitespace | TokenKind.Comment;
const WhitespaceAll = TokenKind.Whitespace | TokenKind.Newline | TokenKind.Comment;

export enum NodeKind {
    // Generated by parser
    File,
    
    // Parsed from user Metadesk code
    Main,
    Tag,
}

export class Node {
    kind: NodeKind;
    flags: NodeFlags;
    string: string;
    rawString: string;
    offset: number;
    comment: string;

    next: Node | undefined;
    prev: Node | undefined;
    parent: Node | undefined;

    children: Node[];
    tags: Node[];

    constructor(kind: NodeKind, str: string, rawStr: string, offset: number) {
        this.kind = kind;
        this.flags = NodeFlags.None;
        this.string = str;
        this.rawString = rawStr;
        this.offset = offset;
        this.comment = "";
    
        this.next = undefined;
        this.prev = undefined;
        this.parent = undefined;

        this.children = [];
        this.tags = [];
    }
}

// TODO: This sucks and isn't universally useful. Error messages should actually show the source
// as it appears. Other things should not. I dunno.
function sanitize(str: string): string {
    str = str.replace(/\n/g, "\\n");
    str = str.replace(/\t/g, "\\t");
    return str;
}

export class ParseResult {
    node: Node | undefined;
    #ctx: ParseContext;

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
            const problem = sanitize(this.#ctx.source.slice(err.offset, err.offset + 1));
            const after = sanitize(this.#ctx.source.slice(err.offset + 1, err.offset + amt));
            const pad = " ".repeat(before.length);
            return `ERROR: ${err.message}
 |
 | ${before}${problem}${after}
 | ${pad}^
 |
`;
        });
    }
}

export function parse(source: string): ParseResult {
    const ctx = new ParseContext(source);
    
    const root = new Node(NodeKind.File, "", source, 0);
    root.children = ctx.parseExplicitChildren();

    return new ParseResult(root, ctx);
}

export enum NodeFlags {
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
    kind: TokenKind;
    // TODO: flags?
    string: string;
    rawString: string;
    remaining: string;

    constructor(kind: TokenKind, string: string, rawString: string, remaining: string) {
        this.kind = kind;
        this.string = string;
        this.rawString = rawString;
        this.remaining = remaining;
    }

    toString(): string {
        let val = sanitize(this.rawString);
        const name = TokenKind[this.kind];
        if (/^ +$/.test(val)) {
            val = `"${val}"`;
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

            // const foo: number = "wow";

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
            const numericMatch = string.match(/^-?[0-9]([eE][+-]|[a-zA-Z0-9._])*/);

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

function getLastComment(tokens: Token[]): Token | undefined {
    let comment: Token | undefined = undefined;
    for (const token of tokens) {
        if (token.kind === TokenKind.Comment) {
            comment = token;
        }
    }
    return comment;
}

function charIsUnreservedSymbol(c: string): boolean {
    return "~!$%^&*-=+<.>/?|".includes(c);
}

function charIsReservedSymbol(c: string): boolean {
    return "{}()\\[]#,;:@".includes(c);
}

export interface Error {
    message: string;
    offset: number;
}

class ParseContext {
    source: string;
    remaining: string;
    last: Token | undefined;
    errors: Error[];

    constructor(source: string) {
        this.source = source;
        this.remaining = source;
        this.errors = [];
    }

    check(
        kind: TokenKind = AllTokens,
        cond: (token: Token) => boolean = () => true,
    ): Token | undefined {
        const token = getToken(this.remaining);
        if (token && (token.kind & kind) && cond(token)) {
            return token;
        } else {
            return undefined;
        }
    }

    consume(
        kind: TokenKind = AllTokens,
        cond: (token: Token) => boolean = () => true,
    ): Token | undefined {
        const token = this.check(kind, cond);
        if (token) {
            this.remaining = token.remaining;
            this.last = token;
        }
        return token;
    }

    consumeAll(
        kind: TokenKind = AllTokens,
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
        this.debug(`ERROR! ${msg}`);
        this.errors.push({
            message: msg,
            offset: offset,
        });
    }

    debug(msg: string) {
        if (!DEBUG) return;
        console.log({
            msg,
            remaining: this.remaining.slice(0, Math.min(30, this.remaining.length)),
        });
    }

    get offset(): number {
        return this.source.length - this.remaining.length;
    }

    /**
     * Consumes line whitespace and returns the last comment, if any.
     */
     consumeWhitespaceLine(): Token | undefined {
        const tokens = this.consumeAll(WhitespaceLine);
        return getLastComment(tokens);
    }

    /**
     * Consumes all whitespace and returns the last comment, if any.
     */
    consumeWhitespaceAll(): Token | undefined {
        const tokens = this.consumeAll(WhitespaceAll);
        return getLastComment(tokens);
    }

    /**
     * Grammar:
     * 
     *     whitespace-node = whitespace-line [NEWLINE] [whitespace-line]
     * 
     * Returns any comment nodes that were encountered.
     */
    consumeWhitespaceNode(): Token | undefined {
        const tokens: Token[] = [];
        tokens.push(...this.consumeAll(WhitespaceLine));
        this.consume(TokenKind.Newline);
        tokens.push(...this.consumeAll(WhitespaceLine));
        return getLastComment(tokens);
    }

    /**
     * Grammar:
     * 
     *     node           = [tag-list [whitespace-all]] (named-node / anonymous-node)
     *     named-node     = label [":" [whitespace-node] (explicit-list / implicit-list)]
     *     anonymous-node = explicit-list
     * 
     * This function parses an entire `node`.
     */
    parseNode(preComment: Token | undefined): Node | undefined {
        this.debug("parseNode");

        const startOffset = this.offset;
        const node = new Node(NodeKind.Main, "", "", this.offset);

        node.tags = this.parseTagList(preComment);
        this.debug(`got ${node.tags.length} tags`);

        const commentToken = this.consumeWhitespaceAll() ?? preComment;
        node.comment = commentToken?.string ?? "";

        const anonymous = this.check(TokenKind.Reserved, t => "([{".includes(t.string));
        if (anonymous) {
            this.debug("node is anonymous");
            const [children, flags] = this.parseExplicitList();
            node.children = children ?? [];
            node.flags |= flags;
        } else {
            const label = this.consume(Label);
            if (label) {
                node.string = label.string;
                this.debug(`node is named: ${node.string}`);
                
                const colon = this.consume(TokenKind.Reserved, t => t.string === ":");
                if (colon) {
                    // Node has children
                    const comment = this.consumeWhitespaceNode();

                    const opener = this.check(TokenKind.Reserved, t => "([{".includes(t.string));
                    if (opener) {
                        const [children, flags] = this.parseExplicitList();
                        node.children = children ?? [];
                        node.flags |= flags;
                    } else {
                        node.children = this.parseImplicitList(comment);
                    }
                }
            } else {
                this.error(`expected a valid node label, but got "${sanitize(this.check()?.string ?? "end of file")}" instead`);
                return undefined;
            }
        }

        const endOffset = this.offset;
        node.rawString = this.source.slice(startOffset, endOffset);

        return node;
    }

    /**
     * Grammar:
     * 
     *     tag-list = "@" label [explicit-list] [whitespace-all] [tag-list]
     * 
     * After parsing, this function verifies that the list of children used parentheses (the only
     * valid delimiter for tag children).
     */
    parseTagList(preComment: Token | undefined): Node[] {
        this.debug("parseTagList");

        const result: Node[] = [];

        let commentToken = preComment;
        for (const _ of forever()) {
            const at = this.consume(TokenKind.Reserved, t => t.string === "@");
            if (!at) {
                break;
            }

            const label = this.consume(Label);
            if (!label) {
                this.error(`"${sanitize(this.last?.rawString ?? "<undefined>")}" is not a proper tag label`);
                break;
            }

            this.debug(`tag is named: ${label.string}`);
            
            const tagNode = new Node(NodeKind.Tag, label.string, label.rawString, this.offset);
            const tagChildrenOffset = this.offset;
            const [tagChildren, tagFlags] = this.parseExplicitList();
            tagNode.flags |= tagFlags;
            tagNode.comment = commentToken?.string ?? "";
            
            const childrenAreParenthesized = tagNode.flags&NodeFlags.HasParenLeft && tagNode.flags&NodeFlags.HasParenRight;
            if (tagChildren !== undefined && !childrenAreParenthesized) {
                this.error("tag children can only be delimited using parentheses", tagChildrenOffset);
            }
            tagNode.children = tagChildren ?? [];

            result.push(tagNode);

            commentToken = this.consumeWhitespaceAll();
        }

        return result;
    }

    /**
     * Grammar:
     * 
     *     explicit-list = ("(" / "[" / "{") explicit-children (")" / "]" / "}")
     * 
     * Note that, while the grammar allows for any combination of opening and closing delimiters,
     * some combinations are forbidden and will be validated separately.
     */
    parseExplicitList(): [Node[] | undefined, NodeFlags] {
        this.debug("parseExplicitList");

        let parentFlags: NodeFlags = 0;

        const openerOffset = this.offset;
        const opener = this.consume(TokenKind.Reserved, t => "([{".includes(t.string));
        if (!opener) {
            this.debug("no list");
            return [undefined, 0];
        }
        switch (opener.string) {
            case "(": parentFlags |= NodeFlags.HasParenLeft; break;
            case "[": parentFlags |= NodeFlags.HasBracketLeft; break;
            case "{": parentFlags |= NodeFlags.HasBraceLeft; break;
        }
        
        const children = this.parseExplicitChildren();

        const closer = this.consume(TokenKind.Reserved, t => ")]}".includes(t.string));
        if (!closer) {
            this.error("List was not terminated", openerOffset);
            return [undefined, 0];
        }

        const isBraced = opener.string === "{" && closer.string === "}";
        const isBracketed = (
            "([".includes(opener.string)
            && ")]".includes(closer.string)
        );
        if (!(isBraced || isBracketed)) {
            this.error(`"${opener.string}" and "${closer.string}" cannot be used together`, openerOffset);
        }

        switch (closer.string) {
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
     *                           node [whitespace-all] [SEPARATOR]
     *                           explicit-children
     *                         ]
     * 
     * Since this part of the grammar only occurs within `explicit-list` and `file`, this function
     * will exit when it sees either a closing delimiter or the end of the token stream. It will
     * not consume the final delimiter, if any, so that `_parseExplicitList` can consume it.
     */
    parseExplicitChildren(): Node[] {
        const result: Node[] = [];

        // Early out if empty
        let commentToken = this.consumeWhitespaceAll();
        const endDelimiter = this.check(TokenKind.Reserved, t => ")]}".includes(t.string));
        if (endDelimiter || this.done()) {
            return result;
        }

        let nextNodeFlags: NodeFlags = 0;
        for (const _ of forever()) {
            const node = this.parseNode(commentToken);
            if (!node) {
                break;
            }
            node.flags |= nextNodeFlags;
            nextNodeFlags = 0;
            result.push(node); // this is JS, so we can continue to modify node after pushing it

            this.consumeWhitespaceAll();
            const separator = this.consume(TokenKind.Reserved, t => ",;".includes(t.string));
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
                }
            }

            // Done with that node, now either start the next or bail
            commentToken = this.consumeWhitespaceAll();
            const endDelimiter = this.check(TokenKind.Reserved, t => ")]}".includes(t.string));
            if (endDelimiter || this.done()) {
                break;
            }
        }

        return result;
    }

    /**
     * Grammar:
     * 
     *     implicit-list     = implicit-children (SEPARATOR / NEWLINE)
     *     implicit-children = node [whitespace-line] [implicit-children]
     * 
     * We parse the two together in a single function for simplicity.
     */
    parseImplicitList(preComment: Token | undefined): Node[] {
        this.debug("parseImplicitList");

        const result: Node[] = [];
        let commentToken = preComment;
        for (const _ of forever()) {
            const node = this.parseNode(commentToken);
            if (!node) {
                this.error("expected a node");
                break;
            }
            result.push(node);

            commentToken = this.consumeWhitespaceLine();
            const nextIsSeparator = this.check(TokenKind.Reserved, t => ",;".includes(t.string));
            const nextIsNewline = this.check(TokenKind.Newline);
            if (nextIsSeparator || nextIsNewline) {
                this.consume();
                break;
            }
        }

        return result;
    }
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
    let out = "";

    function printIndent() {
        for (let i = 0; i < indent; i++) {
            out += indentString;
        }
    }

    if (flags & GenerateFlags.Comments && node.comment) {
        printIndent();
        out += "/*\n";
        printIndent();
        out += `${node.comment}\n`;
        printIndent();
        out += "*/\n";
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
                    const childIndent = i === 0 ? 0 : tagArgIndent;
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
        out += `// kind: "${NodeKind[node.kind]}"\n`;
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

    return out;
}

function stringListFromNodeFlags(flags: NodeFlags): string[] {
    const validFlags = [
        "HasParenLeft",
        "HasParenRight",
        "HasBracketLeft",
        "HasBracketRight",
        "HasBraceLeft",
        "HasBraceRight",
    
        "IsBeforeSemicolon",
        "IsAfterSemicolon",
        "IsBeforeComma",
        "IsAfterComma",

        "StringSingleQuote",
        "StringDoubleQuote",
        "StringTick",
        "StringTriplet",
        
        "Numeric",
        "Identifier",
        "StringLiteral",
        "Symbol",
    ] as const;

    const names: string[] = [];
    for (const flagName of validFlags) {
        if (flags & NodeFlags[flagName]) {
            names.push(flagName);
        }
    }
    return names;
}

function* forever() {
    for (let i = 0; i < 10000; i++) {
        yield true;
    }
    throw new Error("a loop ran on too long");
}
