import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((err) => {
  console.error(err);
  // Bootstrap failed, so SplashService never ran and nothing else will clear
  // the boot splash — index.html holds app-root at opacity 0 behind it, which
  // without this leaves a splash that never leaves over an app that never
  // appears. Reveal whatever did render (an error page, or an empty shell the
  // user can at least reload) rather than a frozen logo.
  const root = document.documentElement;
  root.classList.remove('hm-splash-showing', 'hm-splash-leaving');
  document.getElementById('hm-splash')?.remove();
});
