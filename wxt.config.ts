import { defineConfig } from 'wxt';

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  manifest: {
    name: 'Tab Tree',
    description:
      'Records your browsing as a tree of pages you can annotate, flag and summarize with AI.',
    permissions: ['tabs', 'webNavigation', 'storage', 'sidePanel', 'scripting'],
    host_permissions: ['<all_urls>', 'https://generativelanguage.googleapis.com/*'],
    action: {
      default_title: 'Tab Tree',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
  },
});
