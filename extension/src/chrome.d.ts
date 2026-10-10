// The few browser-extension APIs Bunker Watch uses, declared by hand so the
// build needs no extra package. Anything not listed here is not used.
declare namespace chrome {
  namespace storage {
    const local: {
      get(keys: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
    const onChanged: { addListener(fn: (changes: Record<string, unknown>, area: string) => void): void };
  }
  namespace alarms {
    function create(name: string, info: { periodInMinutes: number; delayInMinutes?: number }): Promise<void> | void;
    function get(name: string): Promise<{ name: string } | undefined>;
    const onAlarm: { addListener(fn: (alarm: { name: string }) => void): void };
  }
  namespace notifications {
    function create(
      id: string,
      options: {
        type: "basic";
        iconUrl: string;
        title: string;
        message: string;
        priority?: number;
        requireInteraction?: boolean;
      },
    ): Promise<string> | void;
    function clear(id: string): Promise<boolean> | void;
    function getAll(): Promise<Record<string, unknown>>;
    const onClicked: { addListener(fn: (id: string) => void): void };
  }
  namespace action {
    function setBadgeText(details: { text: string }): Promise<void>;
    function setBadgeBackgroundColor(details: { color: string }): Promise<void>;
    function setBadgeTextColor(details: { color: string }): Promise<void>;
    function getBadgeText(details: Record<string, never>): Promise<string>;
  }
  namespace runtime {
    function getURL(path: string): string;
    function getManifest(): { version: string };
    function sendMessage(message: unknown): Promise<unknown>;
    const onInstalled: { addListener(fn: () => void): void };
    const onStartup: { addListener(fn: () => void): void };
    const onMessage: {
      addListener(fn: (message: unknown, sender: unknown, reply: (answer: unknown) => void) => boolean | void): void;
    };
  }
  namespace permissions {
    function request(p: { origins: string[] }): Promise<boolean>;
    function remove(p: { origins: string[] }): Promise<boolean>;
  }
  namespace tabs {
    function create(p: { url: string }): Promise<unknown>;
  }
}
