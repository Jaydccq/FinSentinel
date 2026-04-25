import { execFileSync } from 'node:child_process';

const patterns = ["from 'ai'", 'from "ai"', "'@ai-sdk/openai'", '"@ai-sdk/openai"'];

let failed = false;

for (const pattern of patterns) {
  try {
    const output = execFileSync('rg', ['-n', pattern, 'apps', 'packages'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (output.trim()) {
      failed = true;
      process.stderr.write(output);
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && error.status === 1) {
      continue;
    }
    throw error;
  }
}

if (failed) {
  process.stderr.write('Vercel AI SDK imports are not allowed. Use @finsentinel/ai-runtime.\n');
  process.exit(1);
}
