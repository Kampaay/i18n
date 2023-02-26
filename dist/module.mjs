import createDebug from 'debug';
import { isString, isBoolean, isObject, hasOwn, isArray, isRegExp, isFunction } from '@intlify/shared';
import { resolveFiles, resolvePath, extendPages, addWebpackPlugin, extendWebpackConfig, addVitePlugin, extendViteConfig, defineNuxtModule, isNuxt2, getNuxtVersion, isNuxt3, addPlugin, addTemplate, addImports } from '@nuxt/kit';
import { parse, resolve, dirname, normalize, relative } from 'pathe';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs, { promises, constants } from 'node:fs';
import { encodePath, parseURL, parseQuery } from 'ufo';
import { resolveLockfile } from 'pkg-types';
import { localizeRoutes, DefaultLocalizeRoutesPrefixable } from 'vue-i18n-routing';
import { parse as parse$1, compileScript } from '@vue/compiler-sfc';
import { walk } from 'estree-walker';
import MagicString from 'magic-string';
import VueI18nWebpackPlugin from '@intlify/unplugin-vue-i18n/webpack';
import VueI18nVitePlugin from '@intlify/unplugin-vue-i18n/vite';
import { createUnplugin } from 'unplugin';
import { generateJSON } from '@intlify/bundle-utils';
import { genDynamicImport, genSafeVariableName, genImport } from 'knitwork';

const NUXT_I18N_MODULE_ID = "@nuxtjs/i18n";
const VUE_I18N_PKG = "vue-i18n";
const VUE_I18N_BRIDGE_PKG = "@intlify/vue-i18n-bridge";
const VUE_ROUTER_BRIDGE_PKG = "@intlify/vue-router-bridge";
const VUE_I18N_ROUTING_PKG = "vue-i18n-routing";
const STRATEGY_PREFIX_EXCEPT_DEFAULT = "prefix_except_default";
const DEFAULT_OPTIONS = {
  vueI18n: void 0,
  locales: [],
  defaultLocale: "",
  defaultDirection: "ltr",
  routesNameSeparator: "___",
  trailingSlash: false,
  defaultLocaleRouteNameSuffix: "default",
  // sortRoutes: true,
  strategy: STRATEGY_PREFIX_EXCEPT_DEFAULT,
  lazy: false,
  langDir: null,
  rootRedirect: null,
  detectBrowserLanguage: {
    alwaysRedirect: false,
    cookieCrossOrigin: false,
    cookieDomain: null,
    cookieKey: "i18n_redirected",
    cookieSecure: false,
    fallbackLocale: "",
    redirectOn: "root",
    useCookie: true
  },
  differentDomains: false,
  baseUrl: "",
  dynamicRouteParams: false,
  customRoutes: "page",
  pages: {},
  skipSettingLocaleOnNavigate: false,
  onBeforeLanguageSwitch: () => "",
  onLanguageSwitched: () => null,
  types: void 0,
  debug: false
};

const PackageManagerLockFiles = {
  "npm-shrinkwrap.json": "npm-legacy",
  "package-lock.json": "npm",
  "yarn.lock": "yarn",
  "pnpm-lock.yaml": "pnpm"
};
async function getPackageManagerType() {
  try {
    const parsed = parse(await resolveLockfile());
    const lockfile = `${parsed.name}${parsed.ext}`;
    if (lockfile == null) {
      return "unknown";
    }
    const type = PackageManagerLockFiles[lockfile];
    return type == null ? "unknown" : type;
  } catch (e) {
    throw e;
  }
}
function formatMessage(message) {
  return `[${NUXT_I18N_MODULE_ID}]: ${message}`;
}
function getNormalizedLocales(locales) {
  locales = locales || [];
  const normalized = [];
  for (const locale of locales) {
    if (isString(locale)) {
      normalized.push({ code: locale, iso: locale });
    } else {
      normalized.push(locale);
    }
  }
  return normalized;
}
async function resolveLocales(path, locales) {
  const files = await resolveFiles(path, "**/*{json,json5,yaml,yml,ts,js}");
  const find = (f) => files.find((file) => file === resolve(path, f));
  return locales.map((locale) => {
    if (locale.file) {
      locale.path = find(locale.file);
    } else if (locale.files) {
      locale.paths = locale.files.map((file) => find(file)).filter(Boolean);
    }
    return locale;
  });
}
function getLayerRootDirs(nuxt) {
  const layers = nuxt.options._layers;
  return layers.length > 1 ? layers.map((layer) => layer.config.rootDir) : [];
}
async function tryResolve(id, targets, pkgMgr, extention = "") {
  for (const target of targets) {
    if (await isExists(target + extention)) {
      return target;
    }
  }
  throw new Error(`Cannot resolve ${id} on ${pkgMgr}! please install it on 'node_modules'`);
}
async function isExists(path) {
  try {
    await promises.access(path, constants.F_OK);
    return true;
  } catch (e) {
    return false;
  }
}
const PARAM_CHAR_RE = /[\w\d_.]/;
function parseSegment(segment) {
  let state = 0 /* initial */;
  let i = 0;
  let buffer = "";
  const tokens = [];
  function consumeBuffer() {
    if (!buffer) {
      return;
    }
    if (state === 0 /* initial */) {
      throw new Error("wrong state");
    }
    tokens.push({
      type: state === 1 /* static */ ? 0 /* static */ : state === 2 /* dynamic */ ? 1 /* dynamic */ : state === 3 /* optional */ ? 2 /* optional */ : 3 /* catchall */,
      value: buffer
    });
    buffer = "";
  }
  while (i < segment.length) {
    const c = segment[i];
    switch (state) {
      case 0 /* initial */:
        buffer = "";
        if (c === "[") {
          state = 2 /* dynamic */;
        } else {
          i--;
          state = 1 /* static */;
        }
        break;
      case 1 /* static */:
        if (c === "[") {
          consumeBuffer();
          state = 2 /* dynamic */;
        } else {
          buffer += c;
        }
        break;
      case 4 /* catchall */:
      case 2 /* dynamic */:
      case 3 /* optional */:
        if (buffer === "...") {
          buffer = "";
          state = 4 /* catchall */;
        }
        if (c === "[" && state === 2 /* dynamic */) {
          state = 3 /* optional */;
        }
        if (c === "]" && (state !== 3 /* optional */ || buffer[buffer.length - 1] === "]")) {
          if (!buffer) {
            throw new Error("Empty param");
          } else {
            consumeBuffer();
          }
          state = 0 /* initial */;
        } else if (PARAM_CHAR_RE.test(c)) {
          buffer += c;
        } else ;
        break;
    }
    i++;
  }
  if (state === 2 /* dynamic */) {
    throw new Error(`Unfinished param "${buffer}"`);
  }
  consumeBuffer();
  return tokens;
}
function getRoutePath(tokens) {
  return tokens.reduce((path, token) => {
    return path + (token.type === 2 /* optional */ ? `:${token.value}?` : token.type === 1 /* dynamic */ ? `:${token.value}` : token.type === 3 /* catchall */ ? `:${token.value}(.*)*` : encodePath(token.value));
  }, "/");
}

const debug$7 = createDebug("@nuxtjs/i18n:dirs");
const distDir = dirname(fileURLToPath(import.meta.url));
const runtimeDir = fileURLToPath(new URL("./runtime", import.meta.url));
const pkgDir = resolve(distDir, "..");
const pkgModulesDir = resolve(pkgDir, "./node_modules");
debug$7("distDir", distDir);
debug$7("runtimeDir", runtimeDir);
debug$7("pkgDir", pkgDir);
debug$7("pkgModulesDir", pkgModulesDir);

const debug$6 = createDebug("@nuxtjs/i18n:alias");
async function setupAlias(nuxt) {
  const pkgMgr = await getPackageManagerType();
  debug$6("setupAlias: pkgMgr", pkgMgr);
  nuxt.options.alias[VUE_I18N_PKG] = await resolveVueI18nAlias(pkgModulesDir, nuxt, pkgMgr);
  nuxt.options.build.transpile.push(VUE_I18N_PKG);
  debug$6("vue-i18n alias", nuxt.options.alias[VUE_I18N_PKG]);
  nuxt.options.alias["@intlify/shared"] = await resolvePath("@intlify/shared");
  nuxt.options.build.transpile.push("@intlify/shared");
  debug$6("@intlify/shared alias", nuxt.options.alias["@intlify/shared"]);
  nuxt.options.alias[VUE_ROUTER_BRIDGE_PKG] = await resolveVueRouterBridgeAlias(pkgModulesDir, nuxt, pkgMgr);
  nuxt.options.build.transpile.push(VUE_ROUTER_BRIDGE_PKG);
  debug$6("@intlify/vue-router-bridge alias", nuxt.options.alias[VUE_ROUTER_BRIDGE_PKG]);
  nuxt.options.alias[VUE_I18N_BRIDGE_PKG] = await resolveVueI18nBridgeAlias(pkgModulesDir, nuxt, pkgMgr);
  nuxt.options.build.transpile.push(VUE_I18N_BRIDGE_PKG);
  debug$6("@intlify/vue-i18n-bridge alias", nuxt.options.alias[VUE_I18N_BRIDGE_PKG]);
  nuxt.options.alias[VUE_I18N_ROUTING_PKG] = await resolveVueI18nRoutingAlias(pkgModulesDir, nuxt, pkgMgr);
  nuxt.options.build.transpile.push(VUE_I18N_ROUTING_PKG);
  debug$6("vue-i18n-routing alias", nuxt.options.alias[VUE_I18N_ROUTING_PKG]);
}
async function resolveVueI18nAlias(pkgModulesDir2, nuxt, pkgMgr) {
  const { rootDir, workspaceDir } = nuxt.options;
  const modulePath = nuxt.options.dev ? `${VUE_I18N_PKG}/dist/vue-i18n.mjs` : `${VUE_I18N_PKG}/dist/vue-i18n.runtime.mjs`;
  const targets = [
    // for Nuxt layer
    ...getLayerRootDirs(nuxt).map((root) => resolve(root, "node_modules", modulePath)),
    // 1st, try to resolve from `node_modules` (hoisted case)
    resolve(rootDir, "node_modules", modulePath),
    // 2nd, try to resolve from `node_modules/@nuxtjs/i18n` (not hoisted case)
    resolve(pkgModulesDir2, modulePath),
    // workspace directories
    resolve(workspaceDir, "node_modules", modulePath)
  ];
  debug$6(`${VUE_I18N_PKG} resolving from ...`, targets);
  return tryResolve(VUE_I18N_PKG, targets, pkgMgr);
}
async function resolveVueI18nBridgeAlias(pkgModulesDir2, nuxt, pkgMgr) {
  const { rootDir, workspaceDir } = nuxt.options;
  const modulePath = `${VUE_I18N_BRIDGE_PKG}/lib/index.mjs`;
  const targets = [
    // for Nuxt layer
    ...getLayerRootDirs(nuxt).map((root) => resolve(root, "node_modules", modulePath)),
    ...getLayerRootDirs(nuxt).map((root) => resolve(root, `${VUE_I18N_ROUTING_PKG}/node_modules`, modulePath)),
    // 1st, try to resolve from `node_modules` (hoisted case)
    resolve(rootDir, "node_modules", modulePath),
    // 2nd, try to resolve from `node_modules/vue-i18n-routing` (not hoisted case)
    resolve(rootDir, "node_modules", `${VUE_I18N_ROUTING_PKG}/node_modules`, modulePath),
    // 3rd, try to resolve from `node_modules/@nuxtjs/i18n` (not hoisted case)
    resolve(pkgModulesDir2, modulePath),
    // 4th, try to resolve from `node_modules/@nuxtjs/i18n/node_modules/vue-i18n-routing` (not hoisted case)
    resolve(pkgModulesDir2, `${VUE_I18N_ROUTING_PKG}/node_modules`, modulePath),
    // workspace directories
    resolve(workspaceDir, "node_modules", modulePath),
    resolve(workspaceDir, "node_modules", `${VUE_I18N_ROUTING_PKG}/node_modules`, modulePath)
  ];
  debug$6(`${VUE_I18N_BRIDGE_PKG} resolving from ...`, targets);
  return tryResolve(VUE_I18N_BRIDGE_PKG, targets, pkgMgr);
}
async function resolveVueRouterBridgeAlias(pkgModulesDir2, nuxt, pkgMgr) {
  const { rootDir, workspaceDir } = nuxt.options;
  const modulePath = `${VUE_ROUTER_BRIDGE_PKG}/lib/index.mjs`;
  const targets = [
    // for Nuxt layer
    ...getLayerRootDirs(nuxt).map((root) => resolve(root, "node_modules", modulePath)),
    ...getLayerRootDirs(nuxt).map((root) => resolve(root, `${VUE_I18N_ROUTING_PKG}/node_modules`, modulePath)),
    // 1st, try to resolve from `node_modules` (hoisted case)
    resolve(rootDir, "node_modules", modulePath),
    // 2nd, try to resolve from `node_modules/vue-i18n-routing` (not hoisted case)
    resolve(rootDir, "node_modules", `${VUE_I18N_ROUTING_PKG}/node_modules`, modulePath),
    // 3rd, try to resolve from `node_modules/@nuxtjs/i18n` (not hoisted case)
    resolve(pkgModulesDir2, modulePath),
    // 4th, try to resolve from `node_modules/@nuxtjs/i18n/node_modules/vue-i18n-routing` (not hoisted case)
    resolve(pkgModulesDir2, `${VUE_I18N_ROUTING_PKG}/node_modules`, modulePath),
    // workspace directories
    resolve(workspaceDir, "node_modules", modulePath),
    resolve(workspaceDir, "node_modules", `${VUE_I18N_ROUTING_PKG}/node_modules`, modulePath)
  ];
  debug$6(`${VUE_ROUTER_BRIDGE_PKG} resolving from ...`, targets);
  return tryResolve(VUE_ROUTER_BRIDGE_PKG, targets, pkgMgr);
}
async function resolveVueI18nRoutingAlias(pkgModulesDir2, nuxt, pkgMgr) {
  const { rootDir, workspaceDir } = nuxt.options;
  const modulePath = `${VUE_I18N_ROUTING_PKG}/dist/vue-i18n-routing.mjs`;
  const targets = [
    // for Nuxt layer
    ...getLayerRootDirs(nuxt).map((root) => resolve(root, "node_modules", modulePath)),
    // 1st, try to resolve from `node_modules` (hoisted case)
    resolve(rootDir, "node_modules", modulePath),
    // 2nd, try to resolve from `node_modules/@nuxtjs/i18n` (not hoisted case)
    resolve(pkgModulesDir2, modulePath),
    // workspace directories
    resolve(workspaceDir, "node_modules", modulePath)
  ];
  debug$6(`${VUE_I18N_ROUTING_PKG} resolving from ...`, targets);
  return tryResolve(VUE_I18N_ROUTING_PKG, targets, pkgMgr);
}

const debug$5 = createDebug("@nuxtjs/i18n:pages");
function setupPages(options, nuxt, additionalOptions = {
  trailingSlash: false
}) {
  function localizeRoutesPrefixable(opts) {
    return !options.differentDomains && DefaultLocalizeRoutesPrefixable(opts);
  }
  let includeUprefixedFallback = nuxt.options.ssr === false;
  nuxt.hook("nitro:init", () => {
    debug$5("enable includeUprefixedFallback");
    includeUprefixedFallback = true;
  });
  const pagesDir = nuxt.options.dir && nuxt.options.dir.pages ? nuxt.options.dir.pages : "pages";
  const srcDir = nuxt.options.srcDir;
  const { trailingSlash } = additionalOptions;
  debug$5(`pagesDir: ${pagesDir}, srcDir: ${srcDir}, tailingSlash: ${trailingSlash}`);
  extendPages((pages) => {
    debug$5("pages making ...", pages);
    const ctx = {
      stack: [],
      srcDir,
      pagesDir,
      pages: /* @__PURE__ */ new Map()
    };
    analyzeNuxtPages(ctx, pages);
    const localizedPages = localizeRoutes(pages, {
      ...options,
      includeUprefixedFallback,
      localizeRoutesPrefixable,
      optionsResolver: getRouteOptionsResolver(ctx, options)
    });
    pages.splice(0, pages.length);
    pages.unshift(...localizedPages);
    debug$5("... made pages", pages);
  });
}
function analyzeNuxtPages(ctx, pages) {
  const pagesPath = resolve(ctx.srcDir, ctx.pagesDir);
  for (const page of pages) {
    const splited = page.file.split(pagesPath);
    if (splited.length === 2 && splited[1]) {
      const { dir, name } = parse(splited[1]);
      let path = "";
      if (ctx.stack.length > 0) {
        path += `${dir.slice(1, dir.length)}/${name}`;
      } else {
        if (dir !== "/") {
          path += `${dir.slice(1, dir.length)}/`;
        }
        path += name;
      }
      const p = {
        inRoot: ctx.stack.length === 0,
        path
      };
      ctx.pages.set(page, p);
      if (page.children && page.children.length > 0) {
        ctx.stack.push(page.path);
        analyzeNuxtPages(ctx, page.children);
        ctx.stack.pop();
      }
    }
  }
}
function getRouteOptionsResolver(ctx, options) {
  const { pages, defaultLocale, parsePages, customRoutes } = options;
  let useConfig = false;
  if (isBoolean(parsePages)) {
    console.warn(
      formatMessage(
        `'parsePages' option is deprecated. Please use 'customRoutes' option instead. We will remove it in v8 official release.`
      )
    );
    useConfig = !parsePages;
  } else {
    useConfig = customRoutes === "config";
  }
  debug$5("getRouteOptionsResolver useConfig", useConfig);
  return (route, localeCodes) => {
    const ret = useConfig ? getRouteOptionsFromPages(ctx, route, localeCodes, pages, defaultLocale) : getRouteOptionsFromComponent(route, localeCodes);
    debug$5("getRouteOptionsResolver resolved", route.path, route.name, ret);
    return ret;
  };
}
function resolveRoutePath(path) {
  const normalizePath = path.slice(1, path.length);
  const tokens = parseSegment(normalizePath);
  const routePath = getRoutePath(tokens);
  return routePath;
}
function getRouteOptionsFromPages(ctx, route, localeCodes, pages, defaultLocale) {
  const options = {
    locales: localeCodes,
    paths: {}
  };
  const pageMeta = ctx.pages.get(route);
  if (pageMeta == null) {
    console.warn(
      formatMessage(`Couldn't find AnalizedNuxtPageMeta by NuxtPage (${route.path}), so no custom route for it`)
    );
    return options;
  }
  const pageOptions = pageMeta.path ? pages[pageMeta.path] : void 0;
  if (pageOptions === false) {
    return null;
  }
  if (!pageOptions) {
    return options;
  }
  options.locales = options.locales.filter((locale) => pageOptions[locale] !== false);
  for (const locale of options.locales) {
    const customLocalePath = pageOptions[locale];
    if (isString(customLocalePath)) {
      options.paths[locale] = resolveRoutePath(customLocalePath);
      continue;
    }
    const customDefaultLocalePath = pageOptions[defaultLocale];
    if (isString(customDefaultLocalePath)) {
      options.paths[locale] = resolveRoutePath(customDefaultLocalePath);
    }
  }
  return options;
}
function getRouteOptionsFromComponent(route, localeCodes) {
  debug$5("getRouteOptionsFromComponent", route);
  const file = route.component || route.file;
  if (!isString(file)) {
    return null;
  }
  const options = {
    locales: localeCodes,
    paths: {}
  };
  const componentOptions = readComponent(file);
  if (componentOptions == null) {
    return options;
  }
  if (componentOptions === false) {
    return null;
  }
  options.locales = componentOptions.locales || localeCodes;
  const locales = Object.keys(componentOptions.paths || {});
  for (const locale of locales) {
    const customLocalePath = componentOptions.paths[locale];
    if (isString(customLocalePath)) {
      options.paths[locale] = resolveRoutePath(customLocalePath);
    }
  }
  return options;
}
function readComponent(target) {
  let options = void 0;
  try {
    const content = fs.readFileSync(target, "utf8").toString();
    const { descriptor } = parse$1(content);
    if (!descriptor.scriptSetup) {
      return options;
    }
    const desc = compileScript(descriptor, { id: target });
    const { scriptSetupAst } = desc;
    let extract = "";
    if (scriptSetupAst) {
      const s = new MagicString(desc.loc.source);
      scriptSetupAst.forEach((ast) => {
        walk(ast, {
          enter(_node) {
            const node = _node;
            if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "defineI18nRoute") {
              const arg = node.arguments[0];
              if (arg.type === "ObjectExpression") {
                if (verifyObjectValue(arg.properties) && arg.start != null && arg.end != null) {
                  extract = s.slice(arg.start, arg.end);
                }
              } else if (arg.type === "BooleanLiteral" && arg.start != null && arg.end != null) {
                extract = s.slice(arg.start, arg.end);
              }
            }
          }
        });
      });
    }
    if (extract) {
      options = evalValue(extract);
    }
  } catch (e) {
    console.warn(formatMessage(`Couldn't read component data at ${target}: (${e.message})`));
  }
  return options;
}
function verifyObjectValue(properties) {
  let ret = true;
  for (const prop of properties) {
    if (prop.type === "ObjectProperty") {
      if (prop.key.type === "Identifier" && prop.key.name === "locales" || prop.key.type === "StringLiteral" && prop.key.value === "locales") {
        if (prop.value.type === "ArrayExpression") {
          ret = verifyLocalesArrayExpression(prop.value.elements);
        } else {
          console.warn(formatMessage(`'locale' value is required array`));
          ret = false;
        }
      } else if (prop.key.type === "Identifier" && prop.key.name === "paths" || prop.key.type === "StringLiteral" && prop.key.value === "paths") {
        if (prop.value.type === "ObjectExpression") {
          ret = verifyPathsObjectExpress(prop.value.properties);
        } else {
          console.warn(formatMessage(`'paths' value is required object`));
          ret = false;
        }
      }
    } else {
      console.warn(formatMessage(`'defineI18nRoute' is required object`));
      ret = false;
    }
  }
  return ret;
}
function verifyPathsObjectExpress(properties) {
  let ret = true;
  for (const prop of properties) {
    if (prop.type === "ObjectProperty") {
      if (prop.key.type === "Identifier" && prop.value.type !== "StringLiteral") {
        console.warn(formatMessage(`'paths.${prop.key.name}' value is required string literal`));
        ret = false;
      } else if (prop.key.type === "StringLiteral" && prop.value.type !== "StringLiteral") {
        console.warn(formatMessage(`'paths.${prop.key.value}' value is required string literal`));
        ret = false;
      }
    } else {
      console.warn(formatMessage(`'paths' is required object`));
      ret = false;
    }
  }
  return ret;
}
function verifyLocalesArrayExpression(elements) {
  let ret = true;
  for (const element of elements) {
    if (element?.type !== "StringLiteral") {
      console.warn(formatMessage(`required 'locales' value string literal`));
      ret = false;
    }
  }
  return ret;
}
function evalValue(value) {
  try {
    return new Function(`return (${value})`)();
  } catch (e) {
    console.error(formatMessage(`Cannot evaluate value: ${value}`));
    return;
  }
}

const debug$4 = createDebug("@nuxtjs/i18n:messages");
async function extendMessages(nuxt, localeCodes, nuxtOptions) {
  const additionalMessages = [];
  await nuxt.callHook("i18n:extend-messages", additionalMessages, localeCodes);
  debug$4("i18n:extend-messages additional messages", additionalMessages);
  return normalizeMessages(additionalMessages, localeCodes, nuxtOptions);
}
const isNotObjectOrIsArray = (val) => !isObject(val) || isArray(val);
function deepCopy(src, des) {
  for (const key in src) {
    if (hasOwn(src, key)) {
      if (isNotObjectOrIsArray(src[key]) || isNotObjectOrIsArray(des[key])) {
        des[key] = src[key];
      } else {
        deepCopy(src[key], des[key]);
      }
    }
  }
}
function getLocaleCodes(fallback, locales) {
  let fallbackLocales = [];
  if (isArray(fallback)) {
    fallbackLocales = fallback;
  } else if (isObject(fallback)) {
    const targets = [...locales, "default"];
    for (const locale of targets) {
      if (fallback[locale]) {
        fallbackLocales = [...fallbackLocales, ...fallback[locale].filter(Boolean)];
      }
    }
  } else if (isString(fallback) && locales.every((locale) => locale !== fallback)) {
    fallbackLocales.push(fallback);
  }
  return fallbackLocales;
}
async function normalizeMessages(additional, localeCodes, nuxtOptions) {
  let targetLocaleCodes = [...localeCodes];
  if (isObject(nuxtOptions.vueI18n)) {
    nuxtOptions.vueI18n.messages = nuxtOptions.vueI18n.messages || {};
    const locale = nuxtOptions.defaultLocale || nuxtOptions.vueI18n.locale || "en-US";
    const locales = nuxtOptions.vueI18n.fallbackLocale ? getLocaleCodes(nuxtOptions.vueI18n.fallbackLocale, [locale]) : [locale];
    for (const locale2 of locales) {
      nuxtOptions.vueI18n.messages[locale2] = nuxtOptions.vueI18n.messages[locale2] || {};
    }
    for (const [, messages] of Object.entries(additional)) {
      for (const locale2 of locales) {
        deepCopy(messages[locale2], nuxtOptions.vueI18n.messages[locale2]);
      }
    }
    targetLocaleCodes = localeCodes.filter((code) => !locales.includes(code));
    debug$4("vueI18n messages", nuxtOptions.vueI18n.messages);
  }
  const additionalMessages = {};
  for (const localeCode of targetLocaleCodes) {
    additionalMessages[localeCode] = [];
  }
  for (const [, messages] of Object.entries(additional)) {
    for (const [locale, message] of Object.entries(messages)) {
      if (targetLocaleCodes.includes(locale)) {
        additionalMessages[locale].push(message);
      }
    }
  }
  return additionalMessages;
}

const debug$3 = createDebug("@nuxtjs/i18n:macros");
const TransformMacroPlugin = createUnplugin((options) => {
  return {
    name: "nuxtjs:i18n-macros-transform",
    enforce: "post",
    transformInclude(id) {
      if (!id || id.startsWith("\0")) {
        return false;
      }
      const { pathname, search } = parseURL(decodeURIComponent(pathToFileURL(id).href));
      return pathname.endsWith(".vue") || !!parseQuery(search).macro;
    },
    transform(code, id) {
      debug$3("transform", id);
      const s = new MagicString(code);
      const { search } = parseURL(decodeURIComponent(pathToFileURL(id).href));
      function result() {
        if (s.hasChanged()) {
          debug$3("transformed: id -> ", id);
          debug$3("transformed: code -> ", s.toString());
          return {
            code: s.toString(),
            map: options.sourcemap ? s.generateMap({ source: id, includeContent: true }) : void 0
          };
        }
      }
      const match = code.match(new RegExp(`\\b${"defineI18nRoute"}\\s*\\(\\s*`));
      if (match?.[0]) {
        s.overwrite(match.index, match.index + match[0].length, `/*#__PURE__*/ false && ${match[0]}`);
      }
      if (!parseQuery(search).macro) {
        return result();
      }
      return result();
    }
  };
});

const debug$2 = createDebug("@nuxtjs/i18n:bundler");
async function extendBundler(nuxt, options) {
  const { nuxtOptions, hasLocaleFiles, langPath } = options;
  if (nuxt.options.nitro.replace) {
    nuxt.options.nitro.replace["__DEBUG__"] = nuxtOptions.debug;
  } else {
    nuxt.options.nitro.replace = {
      __DEBUG__: nuxtOptions.debug
    };
  }
  debug$2("nitro.replace", nuxt.options.nitro.replace);
  const macroOptions = {
    dev: nuxt.options.dev,
    sourcemap: nuxt.options.sourcemap.server || nuxt.options.sourcemap.client
  };
  try {
    const webpack = await import('webpack').then((m) => m.default || m);
    const webpackPluginOptions = {
      runtimeOnly: true
    };
    if (hasLocaleFiles && langPath) {
      webpackPluginOptions.include = [resolve(langPath, "./**")];
    }
    addWebpackPlugin(VueI18nWebpackPlugin(webpackPluginOptions));
    addWebpackPlugin(TransformMacroPlugin.webpack(macroOptions));
    extendWebpackConfig((config) => {
      config.plugins.push(
        new webpack.DefinePlugin({
          __VUE_I18N_FULL_INSTALL__: "true",
          __VUE_I18N_LEGACY_API__: "true",
          __INTLIFY_PROD_DEVTOOLS__: "false",
          __DEBUG__: JSON.stringify(nuxtOptions.debug)
        })
      );
    });
  } catch (e) {
    debug$2(e.message);
  }
  const vitePluginOptions = {
    runtimeOnly: true
  };
  if (hasLocaleFiles && langPath) {
    vitePluginOptions.include = [resolve(langPath, "./**")];
  }
  addVitePlugin(VueI18nVitePlugin(vitePluginOptions));
  addVitePlugin(TransformMacroPlugin.vite(macroOptions));
  extendViteConfig((config) => {
    if (config.define) {
      config.define["__DEBUG__"] = JSON.stringify(nuxtOptions.debug);
    } else {
      config.define = {
        __DEBUG__: JSON.stringify(nuxtOptions.debug)
      };
    }
    debug$2("vite.config.define", config.define);
  });
}

const debug$1 = createDebug("@nuxtjs/i18n:gen");
function generateLoaderOptions(lazy, langDir, localesRelativeBase, options = {}, misc = { dev: true, ssg: false, ssr: true }) {
  let genCode = "";
  const localeInfo = options.localeInfo || [];
  const syncLocaleFiles = /* @__PURE__ */ new Set();
  const asyncLocaleFiles = /* @__PURE__ */ new Set();
  if (langDir) {
    for (const locale of localeInfo) {
      if (!syncLocaleFiles.has(locale) && !asyncLocaleFiles.has(locale)) {
        (lazy ? asyncLocaleFiles : syncLocaleFiles).add(locale);
      }
    }
  }
  const generatedImports = /* @__PURE__ */ new Map();
  const importMapper = /* @__PURE__ */ new Map();
  function generateSyncImports(gen, path) {
    if (!path) {
      return gen;
    }
    const { base, ext } = parse(path);
    if (!generatedImports.has(base)) {
      let loadPath = path;
      if (langDir) {
        loadPath = resolveLocaleRelativePath(localesRelativeBase, langDir, base);
      }
      const assertFormat = ext.slice(1);
      const variableName = genSafeVariableName(`locale_${convertToImportId(base)}`);
      gen += `${genImport(loadPath, variableName, assertFormat ? { assert: { type: assertFormat } } : {})}
`;
      importMapper.set(base, variableName);
      generatedImports.set(base, loadPath);
    }
    return gen;
  }
  for (const { path, paths } of syncLocaleFiles) {
    (path ? [path] : paths || []).forEach((p) => {
      genCode = generateSyncImports(genCode, p);
    });
  }
  genCode += `${Object.entries(options).map(([rootKey, rootValue]) => {
    if (rootKey === "nuxtI18nOptions") {
      let genCodes = `export const resolveNuxtI18nOptions = async (context) => {
`;
      genCodes += `  const ${rootKey} = Object({})
`;
      for (const [key, value] of Object.entries(rootValue)) {
        if (key === "vueI18n") {
          const optionLoaderVariable = `${key}OptionsLoader`;
          genCodes += `  const ${optionLoaderVariable} = ${isObject(value) ? `async (context) => ${generateVueI18nOptions(value, misc.dev)}
` : isString(value) ? `async (context) => import(${toCode(value)}).then(r => (r.default || r)(context))
` : `async (context) => ${toCode({})}
`}`;
          genCodes += `  ${rootKey}.${key} = await ${optionLoaderVariable}(context)
`;
          if (isString(value)) {
            const parsedLoaderPath = parse(value);
            const loaderFilename = `${parsedLoaderPath.name}${parsedLoaderPath.ext}`;
            genCodes += `  if (${rootKey}.${key}.messages) { console.warn("[${NUXT_I18N_MODULE_ID}]: Cannot include 'messages' option in '${loaderFilename}'. Please use Lazy-load translations."); ${rootKey}.${key}.messages = {}; }
`;
          }
        } else {
          genCodes += `  ${rootKey}.${key} = ${toCode(value)}
`;
        }
      }
      genCodes += `  return nuxtI18nOptions
`;
      genCodes += `}
`;
      return genCodes;
    } else if (rootKey === "nuxtI18nOptionsDefault") {
      return `export const ${rootKey} = Object({${Object.entries(rootValue).map(([key, value]) => {
        return `${key}: ${toCode(value)}`;
      }).join(`,`)}})
`;
    } else if (rootKey === "nuxtI18nInternalOptions") {
      return `export const ${rootKey} = Object({${Object.entries(rootValue).map(([key, value]) => {
        return `${key}: ${toCode(value)}`;
      }).join(`,`)}})
`;
    } else if (rootKey === "localeInfo") {
      let codes = `export const localeMessages = {
`;
      if (langDir) {
        for (const { code, path, paths } of syncLocaleFiles) {
          const syncPaths = path ? [path] : paths || [];
          codes += `  ${toCode(code)}: [${syncPaths.map((path2) => {
            const { base } = parse(path2);
            return `{ key: ${toCode(generatedImports.get(base))}, load: () => Promise.resolve(${importMapper.get(base)}) }`;
          })}],
`;
        }
        for (const { code, path, paths } of asyncLocaleFiles) {
          const dynamicPaths = path ? [path] : paths || [];
          codes += `  ${toCode(code)}: [${dynamicPaths.map((path2) => {
            const { base } = parse(path2);
            const loadPath = resolveLocaleRelativePath(localesRelativeBase, langDir, base);
            return `{ key: ${toCode(loadPath)}, load: ${genDynamicImport(loadPath, { comment: `webpackChunkName: "lang-${base}"` })} }`;
          })}],
`;
        }
      }
      codes += `}
`;
      return codes;
    } else if (rootKey === "additionalMessages") {
      return `export const ${rootKey} = ${generateAdditionalMessages(rootValue, misc.dev)}
`;
    } else {
      return `export const ${rootKey} = ${toCode(rootValue)}
`;
    }
  }).join("\n")}`;
  genCode += `export const NUXT_I18N_MODULE_ID = ${toCode(NUXT_I18N_MODULE_ID)}
`;
  genCode += `export const isSSG = ${toCode(misc.ssg)}
`;
  genCode += `export const isSSR = ${toCode(misc.ssr)}
`;
  debug$1("generate code", genCode);
  return genCode;
}
const IMPORT_ID_CACHES = /* @__PURE__ */ new Map();
function convertToImportId(file) {
  if (IMPORT_ID_CACHES.has(file)) {
    return IMPORT_ID_CACHES.get(file);
  }
  const { name } = parse(file);
  const id = name.replace(/-/g, "_").replace(/\./g, "_");
  IMPORT_ID_CACHES.set(file, id);
  return id;
}
function resolveLocaleRelativePath(relativeBase, langDir, file) {
  return normalize(`${relativeBase}/${langDir}/${file}`);
}
function generateVueI18nOptions(options, dev) {
  let genCode = "Object({";
  for (const [key, value] of Object.entries(options)) {
    if (key === "messages") {
      genCode += `${JSON.stringify(key)}: Object({`;
      for (const [locale, localeMessages] of Object.entries(value)) {
        genCode += `${JSON.stringify(locale)}:${generateJSON(JSON.stringify(localeMessages), { type: "bare", env: dev ? "development" : "production" }).code},`;
      }
      genCode += "}),";
    } else {
      genCode += `${JSON.stringify(key)}:${toCode(value)},`;
    }
  }
  genCode += "})";
  return genCode;
}
function generateAdditionalMessages(value, dev) {
  let genCode = "Object({";
  for (const [locale, messages] of Object.entries(value)) {
    genCode += `${JSON.stringify(locale)}:[`;
    for (const [, p] of Object.entries(messages)) {
      genCode += `() => Promise.resolve(${generateJSON(JSON.stringify(p), { type: "bare", env: dev ? "development" : "production" }).code}),`;
    }
    genCode += `],`;
  }
  genCode += "})";
  return genCode;
}
function stringifyObj(obj) {
  return `Object({${Object.entries(obj).map(([key, value]) => `${JSON.stringify(key)}:${toCode(value)}`).join(`,`)}})`;
}
function toCode(code) {
  if (code === null) {
    return `null`;
  }
  if (code === void 0) {
    return `undefined`;
  }
  if (isString(code)) {
    return JSON.stringify(code);
  }
  if (isRegExp(code) && code.toString) {
    return code.toString();
  }
  if (isFunction(code) && code.toString) {
    return `(${code.toString().replace(new RegExp(`^${code.name}`), "function ")})`;
  }
  if (isArray(code)) {
    return `[${code.map((c) => toCode(c)).join(`,`)}]`;
  }
  if (isObject(code)) {
    return stringifyObj(code);
  }
  return code + ``;
}

const debug = createDebug("@nuxtjs/i18n:module");
const module = defineNuxtModule({
  meta: {
    name: NUXT_I18N_MODULE_ID,
    configKey: "i18n",
    compatibility: {
      nuxt: "^3.0.0-rc.11",
      bridge: false
    }
  },
  defaults: DEFAULT_OPTIONS,
  async setup(i18nOptions, nuxt) {
    const options = i18nOptions;
    debug("options", options);
    checkOptions(options);
    if (isNuxt2(nuxt)) {
      throw new Error(
        formatMessage(
          `We will release >=7.3 <8, See about GitHub Discussions https://github.com/nuxt-community/i18n-module/discussions/1287#discussioncomment-3042457: ${getNuxtVersion(
            nuxt
          )}`
        )
      );
    }
    if (!isNuxt3(nuxt)) {
      throw new Error(formatMessage(`Cannot support nuxt version: ${getNuxtVersion(nuxt)}`));
    }
    if (options.strategy === "no_prefix" && options.differentDomains) {
      console.warn(
        formatMessage(
          "The `differentDomains` option and `no_prefix` strategy are not compatible. Change strategy or disable `differentDomains` option."
        )
      );
    }
    const langPath = isString(options.langDir) ? resolve(nuxt.options.srcDir, options.langDir) : null;
    debug("langDir path", langPath);
    const normalizedLocales = getNormalizedLocales(options.locales);
    const hasLocaleFiles = normalizedLocales.length > 0;
    const localeCodes = normalizedLocales.map((locale) => locale.code);
    const localeInfo = langPath != null ? await resolveLocales(langPath, normalizedLocales) : [];
    debug("localeInfo", localeInfo);
    options.vueI18n = isObject(options.vueI18n) ? options.vueI18n : isString(options.vueI18n) ? resolve(nuxt.options.rootDir, options.vueI18n) : { legacy: false };
    const additionalMessages = await extendMessages(nuxt, localeCodes, options);
    if (options.strategy !== "no_prefix" && localeCodes.length) {
      await setupPages(options, nuxt, { trailingSlash: options.trailingSlash });
    }
    await setupAlias(nuxt);
    addPlugin(resolve(runtimeDir, "plugins/i18n"));
    nuxt.options.alias["#i18n"] = resolve(distDir, "runtime/composables.mjs");
    nuxt.options.build.transpile.push("#i18n");
    addTemplate({
      filename: "i18n.internal.mjs",
      src: resolve(distDir, "runtime/internal.mjs")
    });
    addTemplate({
      filename: "i18n.utils.mjs",
      src: resolve(distDir, "runtime/utils.mjs")
    });
    const localesRelativeBasePath = relative(nuxt.options.buildDir, nuxt.options.srcDir);
    debug("localesRelativeBasePath", localesRelativeBasePath);
    addTemplate({
      filename: "i18n.options.mjs",
      write: true,
      getContents: () => {
        return generateLoaderOptions(
          options.lazy,
          options.langDir,
          localesRelativeBasePath,
          {
            localeCodes,
            localeInfo,
            additionalMessages,
            nuxtI18nOptions: options,
            nuxtI18nOptionsDefault: DEFAULT_OPTIONS,
            nuxtI18nInternalOptions: {
              __normalizedLocales: normalizedLocales
            }
          },
          {
            ssg: nuxt.options._generate,
            ssr: nuxt.options.ssr,
            dev: nuxt.options.dev
          }
        );
      }
    });
    if (!!options.dynamicRouteParams) {
      addPlugin(resolve(runtimeDir, "plugins/meta"));
    }
    const isLegacyMode = () => {
      return isString(options.types) ? options.types === "legacy" : isObject(options.vueI18n) && isBoolean(options.vueI18n.legacy) ? options.vueI18n.legacy : false;
    };
    addPlugin(resolve(runtimeDir, isLegacyMode() ? "plugins/legacy" : "plugins/composition"));
    nuxt.hook("prepare:types", ({ references }) => {
      const vueI18nTypeFilename = resolve(runtimeDir, "types");
      references.push({ path: resolve(nuxt.options.buildDir, vueI18nTypeFilename) });
    });
    await extendBundler(nuxt, {
      nuxtOptions: options,
      hasLocaleFiles,
      langPath
    });
    const pkgMgr = await getPackageManagerType();
    const vueI18nPath = await resolveVueI18nAlias(pkgModulesDir, nuxt, pkgMgr);
    debug("vueI18nPath for auto-import", vueI18nPath);
    await addImports([
      { name: "useI18n", from: vueI18nPath },
      ...[
        "useRouteBaseName",
        "useLocalePath",
        "useLocaleRoute",
        "useSwitchLocalePath",
        "useLocaleHead",
        "useBrowserLocale",
        "useCookieLocale",
        "defineI18nRoute"
      ].map((key) => ({
        name: key,
        as: key,
        from: resolve(runtimeDir, "composables")
      }))
    ]);
    nuxt.options.build.transpile.push("@nuxtjs/i18n");
    nuxt.options.build.transpile.push("@nuxtjs/i18n-edge");
    nuxt.options.vite.optimizeDeps = nuxt.options.vite.optimizeDeps || {};
    nuxt.options.vite.optimizeDeps.exclude = nuxt.options.vite.optimizeDeps.exclude || [];
    nuxt.options.vite.optimizeDeps.exclude.push("vue-i18n");
  }
});
function checkOptions(options) {
  if (options.lazy && !options.langDir) {
    throw new Error(formatMessage('When using the "lazy" option you must also set the "langDir" option.'));
  }
  if (options.langDir) {
    const locales = options.locales || [];
    if (!locales.length || isString(locales[0])) {
      throw new Error(formatMessage('When using the "langDir" option the "locales" must be a list of objects.'));
    }
    for (const locale of locales) {
      if (isString(locale) || !(locale.file || locale.files)) {
        throw new Error(
          formatMessage(
            `All locales must be objects and have the "file" or "files" property set when using "langDir".
Found none in:
${JSON.stringify(
              locale,
              null,
              2
            )}.`
          )
        );
      }
    }
  }
}

export { module as default };
