import { tool } from 'ai';
import { z } from 'zod';

/**
 * Cognitive scaffolding tools — pure logging, no service dependencies.
 *
 * Forces the LLM to structure its reasoning before acting on investment
 * decisions. Inspired by the OpenAlice Thinking Kit pattern.
 *
 * Internal thinking/planning tool surface exposed to the agent.
 */
export function createThinkingTools() {
  return {
    analyzeMarket: tool({
      description:
        'Use this to analyze the current market situation before making any investment decisions. ' +
        'Call this tool to structure your observations and reasoning. ' +
        "This is for ANALYSIS ONLY — it records your thinking process. Use 'planInvestmentAction' " +
        'separately to decide your next actions. ' +
        'Always call this BEFORE making trade recommendations or portfolio changes.',
      inputSchema: z.object({
        observations: z
          .string()
          .describe(
            'What you observe from market data, financials, and indicators',
          ),
        analysis: z
          .string()
          .describe(
            'Your analysis — what do these observations mean for investment risk?',
          ),
        keyFactors: z
          .string()
          .describe(
            'Comma-separated key factors influencing your assessment',
          ),
      }),
      execute: async ({ observations, analysis, keyFactors }) => {
        try {
          return (
            `Analysis recorded. Key factors identified: ${keyFactors}\n\n` +
            "Next step: Use 'planInvestmentAction' to decide what action to take based on this analysis. " +
            'Or use other tools (getStockQuote, calculateRSI, etc.) to gather more data before deciding.'
          );
        } catch (e) {
          return `Error recording market analysis: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    planInvestmentAction: tool({
      description:
        "Use this to plan your next investment action AFTER analyzing the situation with 'analyzeMarket'. " +
        'This commits you to a specific action plan before execution. List your options, choose one, ' +
        'and outline the specific steps you will take. ' +
        'This improves decision quality by forcing structured deliberation before action.',
      inputSchema: z.object({
        options: z
          .string()
          .describe(
            'Numbered list of possible actions (at least 2 options)',
          ),
        decision: z
          .string()
          .describe(
            'Which option you choose and WHY — explain your reasoning',
          ),
        steps: z
          .string()
          .describe(
            'Specific steps you will execute to implement the decision',
          ),
      }),
      execute: async ({ options, decision, steps }) => {
        try {
          return (
            `Investment plan recorded.\n\n` +
            `Decision: ${decision}\n\n` +
            'You may now execute the planned steps. Use the appropriate tools ' +
            '(getStockQuote, getRecentNews, etc.) to carry out your plan.'
          );
        } catch (e) {
          return `Error recording investment plan: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    calculate: tool({
      description:
        'Perform mathematical calculations with precision. Use this for ANY arithmetic instead of ' +
        'calculating yourself — LLMs make math errors. ' +
        'Supports: +, -, *, /, parentheses, decimals, and unary minus. ' +
        "Examples: '150.50 * 100' for position value, '(175 - 150) / 150 * 100' for percentage return.",
      inputSchema: z.object({
        expression: z
          .string()
          .describe(
            "Mathematical expression to evaluate, e.g. '100000 * 0.05' or '(175 - 150) / 150 * 100'",
          ),
      }),
      execute: async ({ expression }) => {
        try {
          const sanitized = expression.trim();
          if (!sanitized) return 'Error: empty expression';
          const result = safeEvaluate(sanitized);
          return `${sanitized} = ${result}`;
        } catch (e) {
          return `Error evaluating expression: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    reportWarning: tool({
      description:
        'Report a warning when you detect anomalies or concerning conditions during analysis. ' +
        'Use this to flag: suspicious data (unusual price movements, missing data), ' +
        'risk threshold breaches (concentration risk, high VaR), ' +
        'market anomalies (volume spikes, unusual options activity), ' +
        'portfolio warnings (margin of safety eroded, correlation spike). ' +
        'This creates a visible alert for the user.',
      inputSchema: z.object({
        message: z.string().describe('Clear description of the warning'),
        severity: z
          .enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
          .describe('Severity: LOW, MEDIUM, HIGH, CRITICAL'),
        details: z
          .string()
          .describe('Additional context or recommended action'),
      }),
      execute: async ({ message, severity, details }) => {
        try {
          return (
            `WARNING [${severity}]: ${message}\n\n` +
            `Details: ${details}\n\n` +
            'This warning has been logged. Consider adjusting your analysis or investment plan accordingly.'
          );
        } catch (e) {
          return `Error reporting warning: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}

// ── Safe recursive-descent expression parser ────────────────────────────────
// Expression parser supporting numbers, +, -, *, /, (), and unary -

type Token =
  | { type: 'NUMBER'; value: number }
  | { type: '+' | '-' | '*' | '/' | '(' | ')' };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if ('+-*/()'.includes(ch)) {
      tokens.push({ type: ch as '+' | '-' | '*' | '/' | '(' | ')' });
      i++;
      continue;
    }
    if (/[\d.]/.test(ch)) {
      let numStr = '';
      while (i < input.length && /[\d.]/.test(input[i]!)) {
        numStr += input[i]!;
        i++;
      }
      tokens.push({ type: 'NUMBER', value: parseFloat(numStr) });
      continue;
    }
    throw new Error(`Unexpected character '${ch}' at position ${i}`);
  }
  return tokens;
}

function safeEvaluate(expression: string): number {
  const tokens = tokenize(expression);
  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }
  function advance(): Token {
    return tokens[pos++]!;
  }

  // expression = term (('+' | '-') term)*
  function parseExpr(): number {
    let left = parseTerm();
    while (peek()?.type === '+' || peek()?.type === '-') {
      const op = advance().type;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  // term = unary (('*' | '/') unary)*
  function parseTerm(): number {
    let left = parseUnary();
    while (peek()?.type === '*' || peek()?.type === '/') {
      const op = advance().type;
      const right = parseUnary();
      if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  // unary = '-' unary | '+' unary | primary
  function parseUnary(): number {
    if (peek()?.type === '-') {
      advance();
      return -parseUnary();
    }
    if (peek()?.type === '+') {
      advance();
      return parseUnary();
    }
    return parsePrimary();
  }

  // primary = NUMBER | '(' expression ')'
  function parsePrimary(): number {
    const tok = peek();
    if (!tok) throw new Error('Unexpected end of expression');
    if (tok.type === 'NUMBER') {
      advance();
      return tok.value;
    }
    if (tok.type === '(') {
      advance();
      const val = parseExpr();
      if (peek()?.type !== ')') throw new Error('Missing closing parenthesis');
      advance();
      return val;
    }
    throw new Error(`Unexpected token '${tok.type}'`);
  }

  const result = parseExpr();
  if (pos < tokens.length) {
    throw new Error('Unexpected characters after expression');
  }
  if (!isFinite(result)) {
    throw new Error('Expression did not evaluate to a finite number');
  }
  return result;
}
