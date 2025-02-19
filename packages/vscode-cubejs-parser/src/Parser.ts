import {Token, Tokenizer, TokenTypes} from './Tokenizer';
import * as assert from "assert";
import {SyntaxError} from './SyntaxError';
import {
  AstNode,
  ExpressionNode,
  FunctionCallExpresssionNode,
  FunctionDeclarationNode,
  NodeTypes,
  ObjectDestructuringPropertyDeclarationNode,
  ObjectPropertyDeclarationNode,
  UnaryExpressionNode,
  VariableNode
} from "./Node";
import {Cube} from "./Cube";

export class Parser {
  private _content = "";
  private _lookahead: Token | null = null;
  private cubes: Record<string, Cube> = {};
  private readonly _tokenizer = new Tokenizer();

  parse(content: string) {
    this._content = content;
    this._tokenizer.init(this._content);
    this._lookahead = this._tokenizer.getNextToken();

    assert(this._lookahead);

    return this.Program();
  }

  private _eat(tokenType: TokenTypes): Token {
    const token = this._lookahead;

    if (!token) {
      throw new SyntaxError(`Unexpected end of input, but expected: ${tokenType}`);
    }

    if (token.type !== tokenType) {
      throw new SyntaxError(`Unexpected token: "${token.value}", expected: ${tokenType}`);
    }

    this._lookahead = this._tokenizer.getNextToken();

    return token;
  }

  Program(): AstNode {
    return new AstNode({
      type: NodeTypes.Program,
      body: this.StatementList(),
    });
  }

  private StatementList(skipLookAheadType: TokenTypes | null = null): AstNode[] {
    const statementList = [];

    do {
      if (this.eatIfLineBreak()) {
        continue;
      }

      statementList.push(this.Statement());
    } while (this._lookahead && this._lookahead.type !== skipLookAheadType);

    return statementList;
  }

  private Statement(): AstNode {
    switch (this._lookahead?.type) {
      case TokenTypes.Semicolon: return this.EmptyStatement();
      case TokenTypes.CurlyBracketOpen: return this.BlockStatement();
      case TokenTypes.LetKeyword:
      case TokenTypes.VarKeyword:
      case TokenTypes.ConstKeyword: return this.VariableStatement();
      case TokenTypes.ReturnKeyword: return this.ReturnStatement();
      case TokenTypes.FunctionKeyword: return this.FunctionStatement();
      default: return this.ExpressionStatement();
    }
  }

  private EmptyStatement(): AstNode {
    this._eat(TokenTypes.Semicolon);
    return new AstNode({type: NodeTypes.EmptyExpression, value: ''});
  }

  private BlockStatement(): AstNode {
    this._eat(TokenTypes.CurlyBracketOpen);
    const body = this._lookahead?.type !== TokenTypes.CurlyBracketClose ? this.StatementList(TokenTypes.CurlyBracketClose) : [];

    this._eat(TokenTypes.CurlyBracketClose);

    return new AstNode({
      type: NodeTypes.BlockStatement,
      body,
    });
  }

  private ReturnStatement() {
    this._eat(TokenTypes.ReturnKeyword);
    return new AstNode({
      type: NodeTypes.ReturnStatement,
      value: this.AdditiveExpression(),
    })
  }

  private VariableStatement(): AstNode {
    let keyword = this._eat(this._lookahead?.type!!);

    const variables: AstNode[] = [];
    do {
      if (this.eatIfLineBreak()) {
        continue;
      }
      variables.push(this.VariableExpression());
    } while (this._lookahead?.type === TokenTypes.Comma && this._eat(TokenTypes.Comma))

    this.eatEndOfExpression();

    return new AstNode({
      type: NodeTypes.VariableStatement,
      value: keyword,
      body: variables,
    })
  }

  private ExpressionStatement(): AstNode {
    const expression = this.Expression();

    this.eatEndOfExpression();

    return expression;
  }

  private Expression(): AstNode {
    return this.AssignmentExpression();
  }

  private VariableExpression(assignmentOperator = TokenTypes.SimpleAssignmentOperator): AstNode {
    const identifier = this._eat(TokenTypes.Identifier);

    if (this._lookahead?.type === assignmentOperator) {
      this._eat(assignmentOperator);
      return new VariableNode(identifier.value, this.Expression());
    }

    return new VariableNode(identifier.value);
  }

  private AssignmentExpression(): AstNode {
    let left = this.AdditiveExpression();

    if (this._lookahead !== null && this.isAssignmentOperator(this._lookahead)) {
      const token = this._eat(this._lookahead.type);
      return new ExpressionNode(
        new Token(token.type, token.value),
        left,
        this.AssignmentExpression(),
      )
    }

    return left;
  }

  private AdditiveExpression(): AstNode {
    let left: AstNode = this.PrimaryExpression();

    while (this._lookahead?.type === TokenTypes.AdditiveOperator) {
      const operator = this._eat(TokenTypes.AdditiveOperator);
      const right = this.PrimaryExpression();

      left = new ExpressionNode(operator, left, right);
    }

    return left;
  }

  private PrimaryExpression(): AstNode {
    switch (this._lookahead?.type) {
      case TokenTypes.RoundBracketOpen: return this.ParenthesizedExpression();
      case TokenTypes.CurlyBracketOpen: return this.ObjectDeclaration();
      case TokenTypes.Identifier: return this.CallableIdentifier();
      case TokenTypes.Spread: return this.SpreadExpression();
      default: return this.Literal();
    }
  }

  private SpreadExpression(): AstNode {
    const token = this._eat(TokenTypes.Spread);
    return new UnaryExpressionNode(token, this.AdditiveExpression());
  }

  private ParenthesizedExpression(): AstNode {
    this._eat(TokenTypes.RoundBracketOpen);
    const expression = this.Expression();
    this._eat(TokenTypes.RoundBracketClose);
    return expression;
  }

  private FunctionStatement(): AstNode {
    this._eat(TokenTypes.FunctionKeyword);
    let identifier = this.Identifier();
    this._eat(TokenTypes.RoundBracketOpen);
    let params = this.FunctionParameterList();
    this._eat(TokenTypes.RoundBracketClose);

    if (this._lookahead?.type !== TokenTypes.CurlyBracketOpen) {
      // body is required
      throw new SyntaxError(`FunctionStatement unexpected "${this._lookahead?.value}" but "{" was expected`);
    }

    const body = this.BlockStatement().body || [];

    return new FunctionDeclarationNode({name: identifier.value, body, params});
  }

  private FunctionParameterList(declarationFn = this.ParameterDeclaration.bind(this)): AstNode[] {
    let params: AstNode[] = [];
    while(this._lookahead?.type !== TokenTypes.RoundBracketClose) {
      const parameter = declarationFn();
      if (this._lookahead?.type === TokenTypes.Comma) {
        this._eat(TokenTypes.Comma);
      }
      params.push(parameter);
    }

    return params;
  }

  private ParameterDeclaration(): AstNode {
    switch (this._lookahead?.type) {
      case TokenTypes.Identifier: return this.Identifier();
      default: return this.ObjectDeclaration(true);
    }
  }

  private ParameterDeclarationForCall(): AstNode {
    return this.AdditiveExpression();
  }

  private ObjectDeclaration(isDestructuring = false): AstNode {
    const object = new AstNode({type: NodeTypes.ObjectDeclaration});
    object.body = [];
    this._eat(TokenTypes.CurlyBracketOpen);

    while (this._lookahead?.type !== TokenTypes.CurlyBracketClose) {
      if (this.eatIfLineBreak()) {
        continue;
      }
      object.body.push(isDestructuring ? this.ObjectDestructuringPropertyDeclaration() : this.ObjectPropertyDeclaration());
    }

    this._eat(TokenTypes.CurlyBracketClose);

    return object;
  }

  private ObjectDestructuringPropertyDeclaration(): AstNode {
    const identifier = this.Identifier();
    let alias;

    if (this._lookahead?.type === TokenTypes.Colon) {
      this._eat(TokenTypes.Colon);
      alias = this.Identifier().value;
    }

    if (this._lookahead?.type === TokenTypes.Comma) {
      this._eat(TokenTypes.Comma);
    }

    return new ObjectDestructuringPropertyDeclarationNode(identifier.value, alias);
  }

  private ObjectPropertyDeclaration(): AstNode {
    let property;

    switch (this._lookahead?.type) {
      case TokenTypes.Spread: {
        property = new ObjectPropertyDeclarationNode({init: this.PrimaryExpression()});
        break;
      }
      default: {
        const identifier = this.ObjectPropertyIdentifier();
        if (this._lookahead?.type === TokenTypes.Colon) {
          this._eat(TokenTypes.Colon);
          property = new ObjectPropertyDeclarationNode({name: identifier.value, init: this.AdditiveExpression()});
        } else {
          property = new ObjectPropertyDeclarationNode({name: identifier.value});
        }
      }
    }

    if (this._lookahead?.type === TokenTypes.Comma) {
      this._eat(TokenTypes.Comma);
    }

    return property;
  }

  private ObjectPropertyIdentifier(): AstNode {
    let identifier;

    if (this._lookahead?.type === TokenTypes.SquareBracketOpen) {
      this._eat(TokenTypes.SquareBracketOpen);
      identifier = this.Identifier();
      this._eat(TokenTypes.SquareBracketClose);
    } else {
      identifier = this.Identifier();
    }

    return identifier;
  }

  private NumericLiteral(): AstNode {
    const token = this._eat(TokenTypes.Number);
    return new AstNode({
      type: NodeTypes.NumericLiteral,
      value: Number(token.value),
    });
  }

  private CallableIdentifier(): AstNode {
    const identifier = this.Identifier();

    if (this._lookahead?.type === TokenTypes.RoundBracketOpen) {
      this._eat(TokenTypes.RoundBracketOpen);
      const params = this.FunctionParameterList(this.ParameterDeclarationForCall.bind(this));
      this._eat(TokenTypes.RoundBracketClose);
      return new FunctionCallExpresssionNode(identifier.value, params);
    }

    return identifier;
  }

  private Identifier() {
    const token = this._eat(TokenTypes.Identifier);
    return new AstNode({
      type: NodeTypes.Identifier,
      value: token.value,
    })
  }

  private StringLiteral(): AstNode {
    const token = this._eat(TokenTypes.String);
    return new AstNode({
      type: NodeTypes.StringLiteral,
      value: token.value.slice(1, -1),
    })
  }

  private Literal() {
    switch (this._lookahead?.type) {
      case TokenTypes.Number: return this.NumericLiteral();
      case TokenTypes.String: return this.StringLiteral();

      default: throw new SyntaxError(`Literal: unexpected literal production tokenType: [${this._lookahead?.type}] tokenValue: [${this._lookahead?.value}]`);
    }
  }

  private eatIfLineBreak(): Token | void {
    if (this._lookahead?.type === TokenTypes.LineBreak) {
      return this._eat(TokenTypes.LineBreak);
    }
  }

  private eatEndOfExpression() {
    this._eat(this._lookahead?.type === TokenTypes.Semicolon ? TokenTypes.Semicolon : TokenTypes.LineBreak);
  }

  private isAssignmentOperator(token: Token) {
    return token.type === TokenTypes.SimpleAssignmentOperator ||
      token.type === TokenTypes.ComplexAssignmentOperator;
  }
}
