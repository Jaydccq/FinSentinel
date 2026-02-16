# Repository Guidelines

## Project Structure & Module Organization
`src/main/java/com/example/finsentinel/` is the backend root. Key packages:
- `agent/` (AI orchestration: `advisor/`, `tool/`, `output/`)
- `controller/`, `service/` (plus `service/scraper` and `service/storage`)
- `security/`, `config/`, `repository/`
- `model/` and `model/enums/`
- `dto/` split by domain (`auth`, `chat`, `portfolio`, `risk`)

Configuration lives in `src/main/resources/application.yaml`. Tests are in `src/test/java/` and should mirror main-package structure as coverage grows.

## Build, Test, and Development Commands
- `./gradlew compileJava`: compile main sources only.
- `./gradlew bootRun`: start the Spring Boot app locally.
- `./gradlew test`: run all JUnit tests.
- `./gradlew clean build`: clean, compile, test, and package.
- `./gradlew test --tests "com.example.finsentinel.service.AuthServiceTest"`: run one test class.

Use Java 21 (toolchain is configured in `build.gradle`).

## Coding Style & Naming Conventions
- Use 4-space indentation and standard Java formatting.
- Package names are lowercase; classes/enums use PascalCase; methods/fields use camelCase.
- Keep controllers thin; business logic belongs in `service/`.
- Prefer constructor injection (`@RequiredArgsConstructor`).
- Use `@ConfigurationProperties` for external config.
- Keep DTOs as Java records in `dto/*`; keep persistence models in `model/*`.

## Testing Guidelines
- Frameworks: JUnit 5, Spring Boot Test, Spring Security Test.
- Test classes: `*Test`; test methods should describe behavior (example: `login_returns_token_for_valid_credentials`).
- Add tests for happy path, validation failures, and auth/security boundaries.
- Run `./gradlew clean test` before opening a PR.
- No enforced coverage gate currently; prioritize meaningful coverage on auth, security, and AI-agent workflows.

## Commit & Pull Request Guidelines
Local `.git` history is not available in this workspace snapshot, so follow Conventional Commits:
- `feat:`, `fix:`, `refactor:`, `test:`, `docs:`

PRs should include:
- concise problem/solution summary
- linked issue (if any)
- affected modules/packages
- test evidence (commands run and results)
- API examples (sample request/response) for endpoint changes

## Security & Configuration Tips
- Do not commit `.env` or real secrets.
- Set `POSTGRES_*`, `REDIS_*`, `JWT_SECRET`, `OPENROUTER_API_KEY`, `POLYGON_API_KEY`, and `FIRECRAWL_API_KEY` via environment variables.
- Replace default local credentials and JWT values in non-development environments.
