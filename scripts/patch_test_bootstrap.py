#!/usr/bin/env python3
"""
Replace the inline TEST_DATABASE_URL bootstrap block in each test file
with a single require('./helpers/test-db') call.
Each file has a slightly different block; we handle each individually.
"""
import sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.join(ROOT, 'tests')

HELPER_LINE = "require('./helpers/test-db');\nconst TEST_DB_URL = process.env.TEST_DATABASE_URL;\n"

# Map: filename -> (old_block, new_block)
# old_block must match exactly (including newlines).

patches = {}

# ── change-password.test.js ───────────────────────────────────────────────────
patches['change-password.test.js'] = (
    "const TEST_DB_URL = process.env.TEST_DATABASE_URL;\n"
    "if (!TEST_DB_URL) {\n"
    "  console.error('TEST_DATABASE_URL env var required');\n"
    "  process.exit(1);\n"
    "}\n"
    "\n"
    "// Safety guard: refuse to run against the production database.\n"
    "const _testDbName = TEST_DB_URL.match(/\\/([^/?]+)(\\?|$)/)?.[1] || '';\n"
    "if (_testDbName === 'birria_fusion_ops') {\n"
    "  console.error('REFUSED: TEST_DATABASE_URL points to the production database (birria_fusion_ops). Use birria_fusion_test.');\n"
    "  process.exit(1);\n"
    "}\n"
    "\n"
    "// Point the app at the test database and provide a strong JWT secret\n"
    "// BEFORE any app modules are required.\n"
    "process.env.DATABASE_URL = TEST_DB_URL;\n"
    "process.env.JWT_SECRET   = require('crypto').randomBytes(48).toString('hex');\n"
    "process.env.NODE_ENV     = 'test';",

    "// Load test DB config from .env.test — never derives credentials from production .env.\n"
    "require('./helpers/test-db');\n"
    "const TEST_DB_URL = process.env.TEST_DATABASE_URL;"
)

# ── inventory-management-2-phase2.test.js ────────────────────────────────────
patches['inventory-management-2-phase2.test.js'] = (
    "// ── Safety guard ──────────────────────────────────────────────────────────────\n"
    "\n"
    "const TEST_DB_URL = process.env.TEST_DATABASE_URL;\n"
    "if (!TEST_DB_URL) { console.error('TEST_DATABASE_URL env var required'); process.exit(1); }\n"
    "\n"
    "const _testDbName = TEST_DB_URL.match(/\\/([^/?]+)(\\?|$)/)?.[1] || '';\n"
    "if (_testDbName === 'birria_fusion_ops') {\n"
    "  console.error('REFUSED: TEST_DATABASE_URL points to the production database. Use birria_fusion_test.');\n"
    "  process.exit(1);\n"
    "}\n"
    "\n"
    "// Set DATABASE_URL before requiring any server modules so the app pool connects\n"
    "// to the test database, not production.\n"
    "process.env.DATABASE_URL = TEST_DB_URL;\n"
    "process.env.JWT_SECRET   = require('crypto').randomBytes(48).toString('hex');\n"
    "process.env.NODE_ENV     = 'test';",

    "// Load test DB config from .env.test — never derives credentials from production .env.\n"
    "require('./helpers/test-db');\n"
    "const TEST_DB_URL = process.env.TEST_DATABASE_URL;"
)

# ── inventory-management-2.test.js ───────────────────────────────────────────
patches['inventory-management-2.test.js'] = (
    "const TEST_DB_URL = process.env.TEST_DATABASE_URL;\n"
    "if (!TEST_DB_URL) { console.error('TEST_DATABASE_URL env var required'); process.exit(1); }\n"
    "\n"
    "// Safety guard: refuse to run against the production database.\n"
    "const _testDbName = TEST_DB_URL.match(/\\/([^/?]+)(\\?|$)/)?.[1] || '';\n"
    "if (_testDbName === 'birria_fusion_ops') {\n"
    "  console.error('REFUSED: TEST_DATABASE_URL points to the production database (birria_fusion_ops). Use birria_fusion_test.');\n"
    "  process.exit(1);\n"
    "}\n"
    "\n"
    "process.env.DATABASE_URL = TEST_DB_URL;\n"
    "process.env.JWT_SECRET   = require('crypto').randomBytes(48).toString('hex');\n"
    "process.env.NODE_ENV     = 'test';",

    "// Load test DB config from .env.test — never derives credentials from production .env.\n"
    "require('./helpers/test-db');\n"
    "const TEST_DB_URL = process.env.TEST_DATABASE_URL;"
)

# ── inventory-purchase-ux.test.js ─────────────────────────────────────────────
patches['inventory-purchase-ux.test.js'] = (
    "const TEST_DB_URL = process.env.TEST_DATABASE_URL;\n"
    "if (!TEST_DB_URL) { console.error('TEST_DATABASE_URL env var required'); process.exit(1); }\n"
    "\n"
    "const _testDbName = TEST_DB_URL.match(/\\/([^/?]+)(\\?|$)/)?.[1] || '';\n"
    "if (_testDbName === 'birria_fusion_ops') {\n"
    "  console.error('REFUSED: TEST_DATABASE_URL points to production. Use birria_fusion_test.');\n"
    "  process.exit(1);\n"
    "}\n"
    "\n"
    "process.env.DATABASE_URL = TEST_DB_URL;\n"
    "process.env.JWT_SECRET   = require('crypto').randomBytes(48).toString('hex');\n"
    "process.env.NODE_ENV     = 'test';",

    "// Load test DB config from .env.test — never derives credentials from production .env.\n"
    "require('./helpers/test-db');\n"
    "const TEST_DB_URL = process.env.TEST_DATABASE_URL;"
)

# ── inventory-txn.test.js ─────────────────────────────────────────────────────
patches['inventory-txn.test.js'] = (
    "const TEST_DB_URL = process.env.TEST_DATABASE_URL;\n"
    "if (!TEST_DB_URL) { console.error('TEST_DATABASE_URL env var required'); process.exit(1); }\n"
    "\n"
    "const _dbName = TEST_DB_URL.match(/\\/([^/?]+)(\\?|$)/)?.[1] || '';\n"
    "if (_dbName === 'birria_fusion_ops') {\n"
    "  console.error('REFUSED: TEST_DATABASE_URL points to production.');\n"
    "  process.exit(1);\n"
    "}\n"
    "\n"
    "process.env.DATABASE_URL = TEST_DB_URL;\n"
    "process.env.JWT_SECRET   = require('crypto').randomBytes(48).toString('hex');\n"
    "process.env.NODE_ENV     = 'test';",

    "// Load test DB config from .env.test — never derives credentials from production .env.\n"
    "require('./helpers/test-db');\n"
    "const TEST_DB_URL = process.env.TEST_DATABASE_URL;"
)

# ── sales-http.test.js ────────────────────────────────────────────────────────
patches['sales-http.test.js'] = (
    "const TEST_DB_URL = process.env.TEST_DATABASE_URL;\n"
    "if (!TEST_DB_URL) { console.error('TEST_DATABASE_URL env var required'); process.exit(1); }\n"
    "\n"
    "// Safety guard: refuse to run against the production database.\n"
    "const _testDbName = TEST_DB_URL.match(/\\/([^/?]+)(\\?|$)/)?.[1] || '';\n"
    "if (_testDbName === 'birria_fusion_ops') {\n"
    "  console.error('REFUSED: TEST_DATABASE_URL points to the production database (birria_fusion_ops). Use birria_fusion_test.');\n"
    "  process.exit(1);\n"
    "}\n"
    "\n"
    "process.env.DATABASE_URL = TEST_DB_URL;\n"
    "process.env.JWT_SECRET   = require('crypto').randomBytes(48).toString('hex');\n"
    "process.env.NODE_ENV     = 'test';",

    "// Load test DB config from .env.test — never derives credentials from production .env.\n"
    "require('./helpers/test-db');\n"
    "const TEST_DB_URL = process.env.TEST_DATABASE_URL;"
)

# ── sales-transaction-safety.test.js ─────────────────────────────────────────
patches['sales-transaction-safety.test.js'] = (
    "const TEST_DB_URL = process.env.TEST_DATABASE_URL;\n"
    "if (!TEST_DB_URL) {\n"
    "  console.error('TEST_DATABASE_URL env var required');\n"
    "  process.exit(1);\n"
    "}\n"
    "\n"
    "const _testDbName = TEST_DB_URL.match(/\\/([^/?]+)(\\?|$)/)?.[1] || '';\n"
    "if (_testDbName === 'birria_fusion_ops') {\n"
    "  console.error('REFUSED: TEST_DATABASE_URL points to the production database (birria_fusion_ops). Use birria_fusion_test.');\n"
    "  process.exit(1);\n"
    "}",

    "// Load test DB config from .env.test — never derives credentials from production .env.\n"
    "require('./helpers/test-db');\n"
    "const TEST_DB_URL = process.env.TEST_DATABASE_URL;"
)

# ── settings-change-password-ui.test.js ──────────────────────────────────────
patches['settings-change-password-ui.test.js'] = (
    "const TEST_DB_URL = process.env.TEST_DATABASE_URL;\n"
    "if (!TEST_DB_URL) {\n"
    "  console.error('TEST_DATABASE_URL env var required');\n"
    "  process.exit(1);\n"
    "}\n"
    "\n"
    "// Safety guard: refuse to run against the production database.\n"
    "const _testDbName = TEST_DB_URL.match(/\\/([^/?]+)(\\?|$)/)?.[1] || '';\n"
    "if (_testDbName === 'birria_fusion_ops') {\n"
    "  console.error('REFUSED: TEST_DATABASE_URL points to the production database (birria_fusion_ops). Use birria_fusion_test.');\n"
    "  process.exit(1);\n"
    "}\n"
    "\n"
    "process.env.DATABASE_URL = TEST_DB_URL;\n"
    "process.env.JWT_SECRET   = require('crypto').randomBytes(48).toString('hex');\n"
    "process.env.NODE_ENV     = 'test';",

    "// Load test DB config from .env.test — never derives credentials from production .env.\n"
    "require('./helpers/test-db');\n"
    "const TEST_DB_URL = process.env.TEST_DATABASE_URL;"
)

errors = 0
for fname, (old, new) in patches.items():
    fpath = os.path.join(TESTS, fname)
    src = open(fpath, encoding='utf-8').read()
    if old not in src:
        print(f'ERROR: block not found in {fname}', file=sys.stderr)
        errors += 1
        continue
    if src.count(old) != 1:
        print(f'ERROR: multiple matches in {fname}', file=sys.stderr)
        errors += 1
        continue
    open(fpath, 'w', encoding='utf-8').write(src.replace(old, new, 1))
    print(f'OK: patched {fname}')

if errors:
    sys.exit(1)
print('All patches applied.')
