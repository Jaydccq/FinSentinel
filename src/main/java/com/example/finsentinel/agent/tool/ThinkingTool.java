package com.example.finsentinel.agent.tool;

import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

/**
 * Cognitive scaffolding tools that force the AI agent to structure its reasoning
 * before acting on investment decisions.
 *
 * <p>Inspired by the OpenAlice Thinking Kit pattern: {@code analyzeMarket} and
 * {@code planInvestmentAction} are deliberately no-op tools whose value comes from
 * forcing the LLM to articulate observations, analysis, options, and decisions in
 * a structured format before executing trades or generating reports.
 *
 * <p>{@code calculate} is a real computation tool — LLMs are notoriously unreliable
 * at arithmetic, so this provides a safe expression evaluator for financial math.
 *
 * <p>{@code reportWarning} flags anomalies and risk threshold breaches for the user.
 */
@Component
@Slf4j
public class ThinkingTool {

    @Tool(description = "Use this to analyze the current market situation before making any investment decisions. "
            + "Call this tool to structure your observations and reasoning. "
            + "This is for ANALYSIS ONLY — it records your thinking process. Use 'planInvestmentAction' "
            + "separately to decide your next actions. "
            + "Always call this BEFORE making trade recommendations or portfolio changes. "
            + "Example: "
            + "- observations: \"AAPL PE ratio is 28, sector average is 22. RSI at 72 (overbought). Revenue grew 8% YoY.\" "
            + "- analysis: \"Stock appears overvalued relative to peers. Overbought on momentum. Growth is moderate but decelerating.\" "
            + "- keyFactors: \"valuation premium, momentum exhaustion, decelerating growth\"")
    public String analyzeMarket(
            @ToolParam(description = "What you observe from market data, financials, and indicators") String observations,
            @ToolParam(description = "Your analysis — what do these observations mean for investment risk?") String analysis,
            @ToolParam(description = "Comma-separated key factors influencing your assessment") String keyFactors) {
        try {
            log.info("AI Analysis — Observations: {}, Factors: {}",
                    observations.substring(0, Math.min(100, observations.length())), keyFactors);

            return String.format("""
                    Analysis recorded. Key factors identified: %s

                    Next step: Use 'planInvestmentAction' to decide what action to take based on this analysis. \
                    Or use other tools (getStockQuote, calculateRSI, etc.) to gather more data before deciding.""",
                    keyFactors);
        } catch (Exception e) {
            log.error("Failed to record market analysis", e);
            return "Error recording market analysis: " + e.getMessage();
        }
    }

    @Tool(description = "Use this to plan your next investment action AFTER analyzing the situation with 'analyzeMarket'. "
            + "This commits you to a specific action plan before execution. List your options, choose one, "
            + "and outline the specific steps you will take. "
            + "This improves decision quality by forcing structured deliberation before action. "
            + "Example: "
            + "- options: \"1. Hold current position, 2. Reduce exposure by 50%, 3. Add stop-loss at $140\" "
            + "- decision: \"Reduce exposure by 50% — stock is overbought and earnings risk is high next week\" "
            + "- steps: \"1. Check current AAPL position size, 2. Calculate target sell quantity, 3. Record rationale\"")
    public String planInvestmentAction(
            @ToolParam(description = "Numbered list of possible actions (at least 2 options)") String options,
            @ToolParam(description = "Which option you choose and WHY — explain your reasoning") String decision,
            @ToolParam(description = "Specific steps you will execute to implement the decision") String steps) {
        try {
            log.info("AI Plan — Decision: {}", decision.substring(0, Math.min(100, decision.length())));

            return String.format("""
                    Investment plan recorded.

                    Decision: %s

                    You may now execute the planned steps. Use the appropriate tools \
                    (getStockQuote, getRecentNews, etc.) to carry out your plan.""",
                    decision);
        } catch (Exception e) {
            log.error("Failed to record investment plan", e);
            return "Error recording investment plan: " + e.getMessage();
        }
    }

    @Tool(description = "Perform mathematical calculations with precision. Use this for ANY arithmetic instead of "
            + "calculating yourself — LLMs make math errors. "
            + "Supports: +, -, *, /, parentheses, decimals, and unary minus. "
            + "Examples: "
            + "- \"150.50 * 100\" for position value "
            + "- \"(175 - 150) / 150 * 100\" for percentage return "
            + "- \"100000 * 0.05\" for 5% of portfolio "
            + "- \"25000 / 175.50\" for shares affordable")
    public String calculate(
            @ToolParam(description = "Mathematical expression to evaluate, e.g. '100000 * 0.05' or '(175 - 150) / 150 * 100'")
            String expression) {
        try {
            String sanitized = expression.strip();
            if (sanitized.isEmpty()) {
                return "Error: empty expression";
            }

            ExpressionParser parser = new ExpressionParser(sanitized);
            BigDecimal result = parser.parseExpression();

            if (!parser.isAtEnd()) {
                return "Error: unexpected characters after expression at position " + parser.position();
            }

            String formatted = result.stripTrailingZeros().toPlainString();
            log.info("Calculate: {} = {}", sanitized, formatted);
            return sanitized + " = " + formatted;
        } catch (ArithmeticException e) {
            log.warn("Arithmetic error evaluating '{}': {}", expression, e.getMessage());
            return "Error: " + e.getMessage();
        } catch (Exception e) {
            log.warn("Failed to evaluate expression '{}': {}", expression, e.getMessage());
            return "Error evaluating expression: " + e.getMessage();
        }
    }

    @Tool(description = "Report a warning when you detect anomalies or concerning conditions during analysis. "
            + "Use this to flag: "
            + "- Suspicious data (unusual price movements, missing data) "
            + "- Risk threshold breaches (concentration risk, high VaR) "
            + "- Market anomalies (volume spikes, unusual options activity) "
            + "- Portfolio warnings (margin of safety eroded, correlation spike) "
            + "This creates a visible alert for the user.")
    public String reportWarning(
            @ToolParam(description = "Clear description of the warning") String message,
            @ToolParam(description = "Severity: LOW, MEDIUM, HIGH, CRITICAL") String severity,
            @ToolParam(description = "Additional context or recommended action") String details) {
        try {
            String normalizedSeverity = severity.strip().toUpperCase();
            if (!List.of("LOW", "MEDIUM", "HIGH", "CRITICAL").contains(normalizedSeverity)) {
                normalizedSeverity = "MEDIUM";
            }

            log.warn("AI Warning [{}]: {} — {}", normalizedSeverity, message, details);

            return String.format("""
                    WARNING [%s]: %s

                    Details: %s

                    This warning has been logged. Consider adjusting your analysis or investment plan accordingly.""",
                    normalizedSeverity, message, details);
        } catch (Exception e) {
            log.error("Failed to report warning", e);
            return "Error reporting warning: " + e.getMessage();
        }
    }

    // -------------------------------------------------------------------------
    // Safe recursive-descent expression parser
    // Supports: numbers (decimals), +, -, *, /, parentheses, unary minus
    // Operator precedence: () > unary- > * / > + -
    // -------------------------------------------------------------------------

    static class ExpressionParser {

        private static final MathContext MC = new MathContext(15, RoundingMode.HALF_UP);

        private final List<Token> tokens;
        private int pos;

        ExpressionParser(String input) {
            this.tokens = tokenize(input);
            this.pos = 0;
        }

        int position() {
            return pos < tokens.size() ? tokens.get(pos).position : -1;
        }

        boolean isAtEnd() {
            return pos >= tokens.size();
        }

        // ---- Tokenizer ----

        private enum TokenType { NUMBER, PLUS, MINUS, STAR, SLASH, LPAREN, RPAREN }

        private record Token(TokenType type, String value, int position) {}

        private List<Token> tokenize(String input) {
            List<Token> result = new ArrayList<>();
            int i = 0;
            while (i < input.length()) {
                char c = input.charAt(i);
                if (Character.isWhitespace(c)) {
                    i++;
                    continue;
                }
                switch (c) {
                    case '+' -> { result.add(new Token(TokenType.PLUS, "+", i)); i++; }
                    case '-' -> { result.add(new Token(TokenType.MINUS, "-", i)); i++; }
                    case '*' -> { result.add(new Token(TokenType.STAR, "*", i)); i++; }
                    case '/' -> { result.add(new Token(TokenType.SLASH, "/", i)); i++; }
                    case '(' -> { result.add(new Token(TokenType.LPAREN, "(", i)); i++; }
                    case ')' -> { result.add(new Token(TokenType.RPAREN, ")", i)); i++; }
                    default -> {
                        if (Character.isDigit(c) || c == '.') {
                            int start = i;
                            boolean hasDot = false;
                            while (i < input.length() && (Character.isDigit(input.charAt(i)) || input.charAt(i) == '.')) {
                                if (input.charAt(i) == '.') {
                                    if (hasDot) {
                                        throw new IllegalArgumentException(
                                                "Invalid number: multiple decimal points at position " + i);
                                    }
                                    hasDot = true;
                                }
                                i++;
                            }
                            result.add(new Token(TokenType.NUMBER, input.substring(start, i), start));
                        } else {
                            throw new IllegalArgumentException(
                                    "Unexpected character '" + c + "' at position " + i);
                        }
                    }
                }
            }
            return result;
        }

        // ---- Parser (recursive descent) ----

        /**
         * expression = term (('+' | '-') term)*
         */
        BigDecimal parseExpression() {
            BigDecimal left = parseTerm();
            while (!isAtEnd()) {
                Token t = tokens.get(pos);
                if (t.type == TokenType.PLUS) {
                    pos++;
                    left = left.add(parseTerm(), MC);
                } else if (t.type == TokenType.MINUS) {
                    pos++;
                    left = left.subtract(parseTerm(), MC);
                } else {
                    break;
                }
            }
            return left;
        }

        /**
         * term = unary (('*' | '/') unary)*
         */
        private BigDecimal parseTerm() {
            BigDecimal left = parseUnary();
            while (!isAtEnd()) {
                Token t = tokens.get(pos);
                if (t.type == TokenType.STAR) {
                    pos++;
                    left = left.multiply(parseUnary(), MC);
                } else if (t.type == TokenType.SLASH) {
                    pos++;
                    BigDecimal divisor = parseUnary();
                    if (divisor.compareTo(BigDecimal.ZERO) == 0) {
                        throw new ArithmeticException("Division by zero");
                    }
                    left = left.divide(divisor, MC);
                } else {
                    break;
                }
            }
            return left;
        }

        /**
         * unary = '-' unary | primary
         */
        private BigDecimal parseUnary() {
            if (!isAtEnd() && tokens.get(pos).type == TokenType.MINUS) {
                pos++;
                return parseUnary().negate();
            }
            // Allow unary plus as well
            if (!isAtEnd() && tokens.get(pos).type == TokenType.PLUS) {
                pos++;
                return parseUnary();
            }
            return parsePrimary();
        }

        /**
         * primary = NUMBER | '(' expression ')'
         */
        private BigDecimal parsePrimary() {
            if (isAtEnd()) {
                throw new IllegalArgumentException("Unexpected end of expression");
            }
            Token t = tokens.get(pos);
            if (t.type == TokenType.NUMBER) {
                pos++;
                return new BigDecimal(t.value);
            }
            if (t.type == TokenType.LPAREN) {
                pos++;
                BigDecimal value = parseExpression();
                if (isAtEnd() || tokens.get(pos).type != TokenType.RPAREN) {
                    throw new IllegalArgumentException("Missing closing parenthesis");
                }
                pos++;
                return value;
            }
            throw new IllegalArgumentException(
                    "Unexpected token '" + t.value + "' at position " + t.position);
        }
    }
}
