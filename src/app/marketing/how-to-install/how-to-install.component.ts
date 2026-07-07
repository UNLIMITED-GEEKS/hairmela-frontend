import { Component, inject, signal } from '@angular/core';
import { InstallPromptService } from '../../core/pwa/install-prompt.service';

// Public help page walking visitors through adding HairMela to their home
// screen. Android gets a one-click Install button when the browser offers it
// (beforeinstallprompt), falling back to manual steps otherwise. iOS has no
// programmatic install API at all (Apple never implemented one) — Add to Home
// Screen only exists in Safari's own Share Sheet, so a non-Safari iOS visitor
// is told to reopen the page in Safari before the steps apply to them.
@Component({
  selector: 'app-how-to-install',
  templateUrl: './how-to-install.component.html',
  styleUrl: './how-to-install.component.scss',
})
export class HowToInstallComponent {
  protected readonly install = inject(InstallPromptService);

  // Printing is for a reference sheet with every platform's full steps, not
  // just whatever this one browser's live install state happens to show —
  // flipping this true forces every card into its instructional branch
  // (hiding install/downloaded buttons) for the duration of the print.
  protected readonly printMode = signal(false);

  protected async installNow(): Promise<void> {
    await this.install.promptInstall();
  }

  protected print(): void {
    this.printMode.set(true);
    // Let the forced instructional branches render before the browser
    // snapshots the page for printing.
    setTimeout(() => {
      window.print();
      this.printMode.set(false);
    });
  }
}
