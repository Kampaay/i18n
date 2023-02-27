<script setup lang="ts">
import { computed } from 'vue'

// import { useLocalePath, useSwitchLocalePath, useLocaleHead, useBrowserLocale } from '#i18n'
import { LocaleObject, useI18n } from '#i18n'

const route = useRoute()
const { t, strategy, locale, locales, localeProperties, setLocale, finalizePendingLocaleChange } = useI18n()
const localePath = useLocalePath()
const switchLocalePath = useSwitchLocalePath()

// route.meta.pageTransition.onBeforeEnter = async () => {
//   await finalizePendingLocaleChange()
// }

console.log('useBrowserLocale', useBrowserLocale())
console.log('localeProperties', localeProperties)
console.log('foo', t('foo'))

function getLocaleName(code: string) {
  const locale = (locales.value as LocaleObject[]).find(i => i.code === code)
  return locale ? locale.name : code
}

const availableLocales = computed(() => {
  return (locales.value as LocaleObject[]).filter(i => i.code !== locale.value)
})

definePageMeta({
  title: 'pages.title.top',
  middleware: () => {
    const localePath2 = useLocalePath()
    console.log('middleware', localePath2({ name: 'blog' }))
  },
  pageTransition: {
    name: 'page',
    mode: 'out-in',
    onBeforeEnter: async () => {
      const { finalizePendingLocaleChange } = useNuxtApp().$i18n
      await finalizePendingLocaleChange()
      console.log('onBeforeEnter')
    }
  }
})

const handler = () => {
  console.log('handler', t('hello', { name: 'nuxt3' }))
}
</script>

<template>
  <div>
    <h1>Demo: Nuxt 3</h1>
    <h2 @click="handler">interpolation: {{ $t('hello', { name: 'nuxt3' }) }}</h2>
    <h2>literalInterpolation: {{ $t('literalInterpolation') }}</h2>
    <h2>pluralization (0): {{ $t('pluralization', 0) }}</h2>
    <h2>pluralization (1): {{ $t('pluralization', 1) }}</h2>
    <!-- <h2>pluralization (5): {{ $t('literalInterpolation', 5, { count: 5 }) }}</h2> -->
    <h2>pluralization (5): {{ $t('pluralization', 5, { count: 5 }) }}</h2>
    <h2>linked: {{ $t('linked') }}</h2>
    <i18n-t keypath="term" tag="label" for="tos">
      <a href="www.google.com" target="_blank">{{ $t('tos') }}</a>
    </i18n-t>
    <h3>scampa: {{ $t('foo', { name: 'scampa' }) }}</h3>
    <h2>Pages</h2>
    <nav>
      <NuxtLink :to="localePath('/')">Home</NuxtLink> | <NuxtLink :to="localePath({ name: 'about' })">About</NuxtLink> |
      <NuxtLink :to="localePath({ name: 'blog' })">Blog</NuxtLink> |
      <NuxtLink :to="localePath({ name: 'category-id', params: { id: 'foo' } })">Category</NuxtLink>
    </nav>
    <h2>Current Language: {{ getLocaleName(locale) }}</h2>
    <h2>Current Strategy: {{ strategy }}</h2>
    <h2>Select Languages with switchLocalePath</h2>
    <nav>
      <span v-for="locale in availableLocales" :key="locale.code">
        <NuxtLink :to="switchLocalePath(locale.code) || ''">{{ locale.name }}</NuxtLink> |
      </span>
    </nav>
    <h2>Select Languages with setLocale</h2>
    <nav>
      <span v-for="locale in availableLocales" :key="locale.code">
        <a href="javascript:void(0)" @click="setLocale(locale.code)">{{ locale.name }}</a> |
      </span>
    </nav>
    <p>{{ $t('settings.profile') }}</p>
  </div>
</template>

<style scoped>
.page-enter-active,
.page-leave-active {
  transition: opacity 1s;
}
.page-enter,
.page-leave-active {
  opacity: 0;
}
</style>
