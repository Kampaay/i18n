// TBD
type I18nCtx = {
  normalize: (args: string[]) => string
  interpolate: (args: any) => string
  named: (args: string) => string
  plural: (args: string[]) => string
  list: (arg: number) => string
  linked: (arg1: string, arg2: undefined, arg3: string /* TBD */) => string
  type: string // ? TBD
}

const pluralRegex = /[^|]+/g

export const delay = <T>(result: T, ms = 2000) => new Promise<T>(resolve => setTimeout(() => resolve(result), ms))

export const bridge = (bundle: Record<string, string>) => {
  return Object.entries(bundle).reduce(
    (acc, [key, value]) => ({
      ...acc,
      [key]: ({
        normalize: _normalize,
        interpolate: _interpolate,
        named: _named,
        plural: _plural,
        list: _list,
        linked: _linked,
        type: _type
      }: I18nCtx) => {
        // search for replacements (e.g. {count})
        let tmpValue = value
        const replMatch = tmpValue.match(/(?<={)[^}]+(?=})/g)

        if (replMatch !== null) {
          // temporarily replace them with {0}, {1}, etc. in order to avoid to let special characters (e.g. |) to be interpreted as pluralization
          replMatch.forEach((m, i) => {
            tmpValue = tmpValue.replace(`{${m}}`, `{${i}}`)
          })
        }

        // search for pluralization (e.g. no apples | one apple | {count} apples) splitting in an array of strings
        const pluralMatch = tmpValue.match(pluralRegex)

        if (pluralMatch === null) {
          throw new Error(`Invalid translated value for key ${key}: "${value}"`)
        }

        let replCount = 0
        const wrapped = pluralMatch.map(plEntry => {
          // The regex expresses either the replacement syntax (e.g. {count}) or the linked syntax (e.g. @:tos)
          // They are split points since they should be wrapped through i18n ctx methods
          const replSplit = plEntry.split(/({[^}]+})|(@:[^\s]+)/)
          return _normalize(
            replSplit.map(r => {
              if (r === `{${replCount}}`) {
                const repl = replMatch![replCount++]

                // https://vue-i18n.intlify.dev/guide/advanced/component.html#slots-syntax-usage
                // if "{}" syntax is used to express slot placeholder replacement, then return the _list(repl) expression
                const slotRepl = Number(repl)
                if (!isNaN(slotRepl)) {
                  return _list(slotRepl)
                }

                const literalIntMatch = /'([^']+)'/g.exec(repl)
                if (literalIntMatch !== null) {
                  // if "{}" syntax is used to express literal interpolation, then return the literal string
                  return literalIntMatch[1]
                }
                // if "{}" syntax is used to express placeholder replacement, then return the _interpolate(_named(repl)) expression
                return _interpolate(_named(repl))
              } else {
                const linkMatch = /(?<=^@:)[^\s]+$/.exec(r)
                if (linkMatch !== null) {
                  // if "@:" syntax is used to express linked placeholder replacement, then return the _linked(_named(linkMatch[0])) expression
                  return _linked(linkMatch[0], undefined, _type)
                }
              }
              return r
            })
          )
        })

        return wrapped.length === 1 ? wrapped[0] : _plural(wrapped)
      }
    }),
    {}
  )
}
