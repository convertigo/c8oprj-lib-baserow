# Generating supported filter types for the `lib_Baserow` library (from Baserow source)

This document explains how to generate the list of **supported view filter types** per **field type** (including formula/lookup-related formula types) for the `lib_Baserow` library, directly from the Baserow frontend source code for a given Baserow version/tag.

The goal is to produce a JSON mapping file (`filter-types-by-field-type.json`) and then paste its content into `lib_Baserow/js/getFilter.js`.

---

## Why this is needed

Baserow defines which **view filters** apply to which **field types** inside its **web frontend** codebase.

Because this mapping can change between Baserow releases, the safest approach is:

1. Checkout the exact Baserow git tag you want to support (example: `1.29.3`)
2. Generate the filter compatibility mapping from that tag’s code
3. Copy the generated JSON into `lib_Baserow`

---

## Prerequisites

- Git
- Node.js (to run the script)

---

## Step 1 — Clone Baserow and checkout the desired tag

```bash
git clone https://gitlab.com/baserow/baserow.git
cd baserow
git checkout 1.29.3
```

Replace 1.29.3 with the tag corresponding to the Baserow version you want to support.

## Step 2 — Create the scripts directory

From the root of the Baserow repository:

```bash
mkdir -p web-frontend/scripts
```

## Step 3 — Add the filter generation script

Create the following file:

```bash
touch web-frontend/scripts/filter-types-for-field.js
```

Paste exactly the following content into it:

```javascript
#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const VIEW_FILTERS_PATH = path.resolve(
  __dirname,
  '../modules/database/viewFilters.js'
)
const ARRAY_VIEW_FILTERS_PATH = path.resolve(
  __dirname,
  '../modules/database/arrayViewFilters.js'
)
const PLUGIN_PATH = path.resolve(__dirname, '../modules/database/plugin.js')

const FORMULA_FIELD_TYPES = new Set(['formula', 'count', 'rollup', 'lookup'])

function readInputField(argv) {
  if (argv.length === 0 && process.stdin.isTTY) {
    throw new Error('Provide a field JSON string, file path, or stdin.')
  }

  let raw = ''
  if (argv.length > 0) {
    const arg = argv[0]
    if (arg === '-' || arg === '--stdin') {
      raw = fs.readFileSync(0, 'utf8')
    } else if (fs.existsSync(arg)) {
      raw = fs.readFileSync(arg, 'utf8')
    } else {
      raw = arg
    }
  } else {
    raw = fs.readFileSync(0, 'utf8')
  }

  return JSON.parse(raw)
}

function stripComments(code) {
  let out = ''
  let inSingle = false
  let inDouble = false
  let inTemplate = false
  let inLine = false
  let inBlock = false
  let escape = false

  for (let i = 0; i < code.length; i++) {
    const ch = code[i]
    const next = code[i + 1]

    if (inLine) {
      if (ch === '\n') {
        inLine = false
        out += ch
      }
      continue
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false
        i++
      }
      continue
    }

    if (inSingle) {
      out += ch
      if (!escape && ch === "'") {
        inSingle = false
      }
      escape = !escape && ch === '\\'
      continue
    }
    if (inDouble) {
      out += ch
      if (!escape && ch === '"') {
        inDouble = false
      }
      escape = !escape && ch === '\\'
      continue
    }
    if (inTemplate) {
      out += ch
      if (!escape && ch === '`') {
        inTemplate = false
      }
      escape = !escape && ch === '\\'
      continue
    }

    if (ch === '/' && next === '/') {
      inLine = true
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      inBlock = true
      i++
      continue
    }

    if (ch === "'") {
      inSingle = true
      out += ch
      escape = false
      continue
    }
    if (ch === '"') {
      inDouble = true
      out += ch
      escape = false
      continue
    }
    if (ch === '`') {
      inTemplate = true
      out += ch
      escape = false
      continue
    }

    out += ch
  }

  return out
}

function findMatching(code, openIndex, openChar, closeChar) {
  let depth = 0
  let inSingle = false
  let inDouble = false
  let inTemplate = false
  let escape = false

  for (let i = openIndex; i < code.length; i++) {
    const ch = code[i]

    if (inSingle) {
      if (!escape && ch === "'") inSingle = false
      escape = !escape && ch === '\\'
      continue
    }
    if (inDouble) {
      if (!escape && ch === '"') inDouble = false
      escape = !escape && ch === '\\'
      continue
    }
    if (inTemplate) {
      if (!escape && ch === '`') inTemplate = false
      escape = !escape && ch === '\\'
      continue
    }

    if (ch === "'") {
      inSingle = true
      escape = false
      continue
    }
    if (ch === '"') {
      inDouble = true
      escape = false
      continue
    }
    if (ch === '`') {
      inTemplate = true
      escape = false
      continue
    }

    if (ch === openChar) {
      depth++
    } else if (ch === closeChar) {
      depth--
      if (depth === 0) {
        return i
      }
    }
  }
  return -1
}

function splitTopLevel(input, delimiter = ',') {
  const parts = []
  let current = ''
  let depthParen = 0
  let inSingle = false
  let inDouble = false
  let inTemplate = false
  let escape = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (inSingle) {
      current += ch
      if (!escape && ch === "'") inSingle = false
      escape = !escape && ch === '\\'
      continue
    }
    if (inDouble) {
      current += ch
      if (!escape && ch === '"') inDouble = false
      escape = !escape && ch === '\\'
      continue
    }
    if (inTemplate) {
      current += ch
      if (!escape && ch === '`') inTemplate = false
      escape = !escape && ch === '\\'
      continue
    }

    if (ch === "'") {
      inSingle = true
      current += ch
      escape = false
      continue
    }
    if (ch === '"') {
      inDouble = true
      current += ch
      escape = false
      continue
    }
    if (ch === '`') {
      inTemplate = true
      current += ch
      escape = false
      continue
    }

    if (ch === '(') depthParen++
    if (ch === ')') depthParen--

    if (ch === delimiter && depthParen === 0) {
      if (current.trim() !== '') {
        parts.push(current.trim())
      }
      current = ''
      continue
    }

    current += ch
  }

  if (current.trim() !== '') {
    parts.push(current.trim())
  }
  return parts
}

function parseStringLiteral(value) {
  const match = value.match(/^['"]([^'"]*)['"]$/)
  return match ? match[1] : null
}

function parseFormulaArgs(argsSource) {
  const args = splitTopLevel(argsSource)
  const types = []
  for (const raw of args) {
    const trimmed = raw.trim()
    const literal = parseStringLiteral(trimmed)
    if (literal !== null) {
      types.push(literal)
      continue
    }

    const arrayMatch = trimmed.match(
      /^FormulaFieldType\.arrayOf\s*\(\s*(['"])([^'"]+)\1\s*\)$/
    )
    if (arrayMatch) {
      types.push(`array(${arrayMatch[2]})`)
    }
  }
  return types
}

function parseCompatibleArray(arraySource) {
  const items = splitTopLevel(arraySource)
  const result = []

  for (const raw of items) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    const literal = parseStringLiteral(trimmed)
    if (literal !== null) {
      result.push({ kind: 'type', value: literal })
      continue
    }

    const formulaMatch = trimmed.match(
      /^FormulaFieldType\.compatibleWithFormulaTypes\s*\(([\s\S]*)\)$/
    )
    if (formulaMatch) {
      const types = parseFormulaArgs(formulaMatch[1])
      if (types.length > 0) {
        result.push({ kind: 'formula', types })
      }
    }
  }
  return result
}

function extractCompatibleFromBody(body) {
  const methodIndex = body.indexOf('getCompatibleFieldTypes')
  if (methodIndex === -1) return null

  const braceIndex = body.indexOf('{', methodIndex)
  if (braceIndex === -1) return null
  const methodEnd = findMatching(body, braceIndex, '{', '}')
  if (methodEnd === -1) return null

  const methodBody = body.slice(braceIndex + 1, methodEnd)
  const returnIndex = methodBody.indexOf('return')
  if (returnIndex === -1) return null

  const arrayStart = methodBody.indexOf('[', returnIndex)
  if (arrayStart === -1) return null
  const arrayEnd = findMatching(methodBody, arrayStart, '[', ']')
  if (arrayEnd === -1) return null

  const arraySource = methodBody.slice(arrayStart + 1, arrayEnd)
  return parseCompatibleArray(arraySource)
}

function parseMixins(code) {
  const mixins = {}
  const mixinRegex = /\bconst\s+([A-Za-z0-9_]+)\s*=\s*\{/g
  let match
  while ((match = mixinRegex.exec(code)) !== null) {
    const name = match[1]
    if (!name.includes('Mixin')) {
      continue
    }
    const bodyStart = match.index + match[0].length - 1
    const bodyEnd = findMatching(code, bodyStart, '{', '}')
    if (bodyEnd === -1) {
      continue
    }
    const body = code.slice(bodyStart + 1, bodyEnd)
    const compat = extractCompatibleFromBody(body)
    if (compat && compat.length > 0) {
      mixins[name] = compat
    }
  }
  return mixins
}

function parseClasses(code) {
  const classes = {}
  const classRegex =
    /\bclass\s+([A-Za-z0-9_]+)(?:\s+extends\s+([A-Za-z0-9_]+|\s*mix\s*\([\s\S]*?\)))?\s*\{/g
  let match
  while ((match = classRegex.exec(code)) !== null) {
    const name = match[1]
    const extendsRaw = match[2] ? match[2].trim() : null
    const bodyStart = match.index + match[0].length - 1
    const bodyEnd = findMatching(code, bodyStart, '{', '}')
    if (bodyEnd === -1) continue
    const body = code.slice(bodyStart + 1, bodyEnd)

    let parent = null
    let mixins = []
    if (extendsRaw) {
      if (extendsRaw.startsWith('mix')) {
        const parenIndex = extendsRaw.indexOf('(')
        const closeIndex = extendsRaw.lastIndexOf(')')
        if (parenIndex !== -1 && closeIndex !== -1) {
          const mixinSource = extendsRaw.slice(parenIndex + 1, closeIndex)
          mixins = splitTopLevel(mixinSource).map((m) => m.trim())
        }
      } else {
        parent = extendsRaw
      }
    }

    const typeMatch = body.match(
      /static\s+getType\s*\(\)\s*\{\s*return\s+['"]([^'"]+)['"]\s*;?\s*\}/
    )
    const type = typeMatch ? typeMatch[1] : null

    const compat = extractCompatibleFromBody(body)
    classes[name] = {
      name,
      parent,
      mixins,
      type,
      compat,
      bodyStart,
    }
  }
  return classes
}

function parseRegisteredFilterClasses(code) {
  const result = []
  const regex =
    /\$registry\.register\(\s*['"]viewFilter['"]\s*,\s*new\s+([A-Za-z0-9_]+)\s*\(/g
  let match
  while ((match = regex.exec(code)) !== null) {
    result.push(match[1])
  }
  return result
}

function resolveCompatibility(name, classes, mixins, seen = new Set()) {
  if (seen.has(name)) return []
  seen.add(name)
  const def = classes[name]
  if (!def) return []
  if (def.compat && def.compat.length > 0) return def.compat

  let compat = []
  if (def.mixins && def.mixins.length > 0) {
    for (const mixin of def.mixins) {
      if (mixins[mixin]) {
        compat = compat.concat(mixins[mixin])
      }
    }
  }

  if (compat.length === 0 && def.parent) {
    compat = resolveCompatibility(def.parent, classes, mixins, seen)
  }

  return dedupeCompat(compat)
}

function dedupeCompat(compat) {
  const seen = new Set()
  const result = []
  for (const item of compat) {
    const key =
      item.kind === 'formula'
        ? `${item.kind}:${item.types.join('|')}`
        : `${item.kind}:${item.value}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push(item)
    }
  }
  return result
}

function fieldMatchesCompat(field, compat) {
  for (const entry of compat) {
    if (entry.kind === 'type') {
      if (entry.value === field.type) {
        return true
      }
    } else if (entry.kind === 'formula') {
      if (!FORMULA_FIELD_TYPES.has(field.type)) {
        continue
      }
      const formulaType = field.formula_type
      const arrayType = field.array_formula_type
        ? `array(${field.array_formula_type})`
        : null
      if (
        (formulaType && entry.types.includes(formulaType)) ||
        (arrayType && entry.types.includes(arrayType))
      ) {
        return true
      }
    }
  }
  return false
}

function loadDefinitions() {
  const files = [VIEW_FILTERS_PATH, ARRAY_VIEW_FILTERS_PATH]
  const classes = {}
  const mixins = {}

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue
    const raw = fs.readFileSync(filePath, 'utf8')
    const code = stripComments(raw)
    Object.assign(mixins, parseMixins(code))
    Object.assign(classes, parseClasses(code))
  }

  return { classes, mixins }
}

function buildFilterCompatibilityList() {
  const { classes, mixins } = loadDefinitions()
  const pluginCode = stripComments(fs.readFileSync(PLUGIN_PATH, 'utf8'))
  const registered = parseRegisteredFilterClasses(pluginCode)

  const list = []
  for (const className of registered) {
    const def = classes[className]
    if (!def || !def.type) {
      continue
    }
    const compat = resolveCompatibility(className, classes, mixins)
    if (compat.length === 0) {
      continue
    }
    list.push({ type: def.type, compat })
  }
  return list
}

function addToMap(map, key, value) {
  if (!map[key]) {
    map[key] = []
  }
  map[key].push(value)
}

function normalizeMap(map) {
  const result = {}
  for (const key of Object.keys(map).sort()) {
    result[key] = Array.from(new Set(map[key])).sort()
  }
  return result
}

function buildFilterTypesByFieldType() {
  const list = buildFilterCompatibilityList()
  const fieldTypes = {}
  const formulaTypes = {}

  for (const filter of list) {
    for (const entry of filter.compat) {
      if (entry.kind === 'type') {
        addToMap(fieldTypes, entry.value, filter.type)
      } else if (entry.kind === 'formula') {
        for (const type of entry.types) {
          addToMap(formulaTypes, type, filter.type)
        }
      }
    }
  }

  return {
    field_types: normalizeMap(fieldTypes),
    formula_types: normalizeMap(formulaTypes),
  }
}

function main() {
  const args = process.argv.slice(2)
  const dumpCompat = args.includes('--dump-compat')
  const dumpByFieldType = args.includes('--dump-by-field-type')
  const inputArgs = args.filter(
    (arg) => arg !== '--dump-compat' && arg !== '--dump-by-field-type'
  )

  if (dumpCompat) {
    const list = buildFilterCompatibilityList()
    process.stdout.write(`${JSON.stringify(list, null, 2)}\n`)
    return
  }

  if (dumpByFieldType) {
    const map = buildFilterTypesByFieldType()
    process.stdout.write(`${JSON.stringify(map, null, 2)}\n`)
    return
  }

  const field = readInputField(inputArgs)
  if (!field || typeof field.type !== 'string') {
    throw new Error('Field JSON must include a "type" string.')
  }

  const list = buildFilterCompatibilityList()
  const result = []
  for (const filter of list) {
    if (fieldMatchesCompat(field, filter.compat)) {
      result.push(filter.type)
    }
  }

  process.stdout.write(`${result.join(' ')}\n`)
}

try {
  main()
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
```

## Step 4 — Run the script to generate the JSON mapping

From the root of the Baserow repository, execute:

```bash
node web-frontend/scripts/filter-types-for-field.js --dump-by-field-type \
  > web-frontend/scripts/filter-types-by-field-type.json
```

This generates the file:

```bash
web-frontend/scripts/filter-types-by-field-type.json
```

## Step 5 — Copy the generated JSON into lib_Baserow

1. Open the generated file:

```bash
web-frontend/scripts/filter-types-by-field-type.json
```

2. Copy the full JSON content

3. Paste it into the following file in your lib_Baserow project:

```bash
lib_Baserow/js/getFilter.js
```

Replace the existing filter-type mapping with the newly generated content.

### What the generated JSON contains

The output JSON has the following structure:
```json
{
  "field_types": {
    "text": ["equal", "contains", "..."],
    "number": ["higher_than", "lower_than", "..."]
  },
  "formula_types": {
    "text": ["equal", "contains", "..."],
    "array(number)": ["contains", "..."]
  }
}
```

* ``field_types`` → filters supported by native field types

* ``formula_types`` → filters supported by formula, lookup, rollup, and count fields depending on their resolved formula type

### When to rerun this process

You must rerun this process whenever:

You upgrade Baserow to a new version

You want to ensure exact compatibility with a specific Baserow release

### Filter behavior changes in Baserow frontend code

Summary

✔ Ensures 100% accurate filter compatibility

✔ Automatically adapts to Baserow changes

✔ Avoids hardcoding unsupported filters

✔ Version-safe and reproducible

This is the recommended and canonical way to maintain filter compatibility in lib_baserow.