import { NuxtApp } from '@nuxt/schema'
import { bridge, delay } from './bridge'

// https://i18n.nuxtjs.org/lazy-load-translations
export default (_context: NuxtApp, _locale: string) => {
  console.log('>>>>>>>>>>>>>>>>>>>>>>> simulating network latency in i18n bundle fetching...')
  // return delay(staticT(bundle))
  // return delay(bundle)
  return delay(
    bridge({
      literalInterpolation: `Interpolazione del carattere speciale {'|'} funziona come atteso`,
      tos: 'Termini di servizio',
      term: 'Accetto xxx {0}.',
      linked: '@:tos linkato',
      pluralization: 'no apples | one apple | {count} apples',
      hello: 'mammmmmmmmaronnlocarm {name} !'
    })
  )
}
