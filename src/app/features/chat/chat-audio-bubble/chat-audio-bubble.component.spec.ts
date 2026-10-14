import { TestBed } from '@angular/core/testing';
import { ChatAudioBubbleComponent } from './chat-audio-bubble.component';

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  preload = '';
  playbackRate = 1;
  currentTime = 0;
  duration = Infinity;
  readyState = 0;
  pause = vi.fn(() => this.dispatchEvent(new Event('pause')));
  play = vi.fn(() => {
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  removeAttribute = vi.fn();
  load = vi.fn();
  constructor(readonly src: string) {
    super();
    FakeAudio.instances.push(this);
  }
}

describe('ChatAudioBubbleComponent playback lifecycle', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    FakeAudio.instances = [];
    vi.stubGlobal('Audio', FakeAudio);
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  function bubble() {
    const fixture = TestBed.createComponent(ChatAudioBubbleComponent);
    fixture.componentRef.setInput('audioUrl', 'https://r2.hairmela.com/note.webm');
    fixture.componentRef.setInput('duration', 24);
    fixture.detectChanges();
    return fixture;
  }

  it('releases the active player when destroyed so another message does not retain it', () => {
    const first = bubble();
    (first.nativeElement.querySelector('button') as HTMLButtonElement).click();
    const audio = FakeAudio.instances[0];
    first.destroy();
    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.removeAttribute).toHaveBeenCalledWith('src');
    expect(audio.load).toHaveBeenCalledTimes(1);
    const second = bubble();
    (second.nativeElement.querySelector('button') as HTMLButtonElement).click();
    expect(audio.pause).toHaveBeenCalledTimes(1);
    second.destroy();
  });

  it('clears an old loading error and detaches old events when the URL changes', () => {
    const fixture = bubble();
    fixture.nativeElement.querySelector('button').click();
    const audio = FakeAudio.instances[0];
    audio.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button').disabled).toBe(true);
    fixture.componentRef.setInput('audioUrl', 'https://r2.hairmela.com/replacement.webm');
    fixture.detectChanges();
    audio.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button').disabled).toBe(false);
    fixture.destroy();
  });

  it('uses the supplied duration for unbounded WebM metadata and defers seeking until metadata loads', () => {
    const fixture = bubble();
    const slider = fixture.nativeElement.querySelector('[role=slider]') as HTMLElement;
    slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const audio = FakeAudio.instances[0];
    expect(audio.currentTime).toBe(0);
    audio.readyState = 1;
    audio.dispatchEvent(new Event('loadedmetadata'));
    fixture.detectChanges();
    expect(audio.currentTime).toBe(5);
    expect(slider.getAttribute('aria-valuemax')).toBe('24');
    expect(audio.play).not.toHaveBeenCalled();
    fixture.destroy();
  });
});
