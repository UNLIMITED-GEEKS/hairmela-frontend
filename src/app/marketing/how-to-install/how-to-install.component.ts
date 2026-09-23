import { Component, inject, signal } from '@angular/core';
import { InstallPromptService } from '../../core/pwa/install-prompt.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { YoutubeEmbedComponent } from '../../shared/components/youtube-embed/youtube-embed.component';

// Public help page walking visitors through adding HairMela to their home
// screen. Android installs through Google Play. iOS has no programmatic web
// install API (Apple never implemented one), so the page provides a short
// walkthrough video and keeps the Safari Add to Home Screen steps as a written
// fallback.
@Component({
  selector: 'app-how-to-install',
  imports: [IconComponent, YoutubeEmbedComponent],
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
