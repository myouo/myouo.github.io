import { createSignal, onMount, createEffect, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { cn } from "@lib/utils";

type Mode = "list" | "single" | "random";
const PLAYBACK_MODES: Mode[] = ["list", "single", "random"];

// Global state to persist between page transitions (Astro ViewTransitions)
const [state, setState] = createStore({
  isPlaying: false,
  currentMode: "list" as Mode,
  currentTrackIndex: 0,
  volume: 0.5,
  currentTime: 0,
  isMuted: false,
  showPlaylist: false,
  showVolume: false,
});

// Singleton audio instance to prevent multiple players and persist playback
let globalAudio: HTMLAudioElement | undefined;

type Props = {
  tracks: string[];
};

export default function MusicPlayer(props: Props) {
  const [localTracks, setLocalTracks] = createSignal<string[]>([]);

  onMount(() => {
    setLocalTracks(props.tracks);
    
    if (typeof window !== "undefined") {
      if (!globalAudio) {
        globalAudio = new Audio();
        globalAudio.volume = state.volume;
        
        // Setup audio listeners
        globalAudio.addEventListener("ended", handleEnded);
        globalAudio.addEventListener("timeupdate", () => {
          setState("currentTime", globalAudio?.currentTime || 0);
        });
        
        // Set initial track
        if (props.tracks.length > 0) {
          globalAudio.src = props.tracks[state.currentTrackIndex];
        }

        // Try to autoplay
        if (state.isPlaying) {
          globalAudio.play().catch(() => setState("isPlaying", false));
        }
      } else {
        // Sync state if audio exists
        if (state.isPlaying && globalAudio.paused) {
           globalAudio.play().catch(() => setState("isPlaying", false));
        }
      }

      // Close dropdowns on outside click
      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (!target.closest('.music-player-container')) {
          setState("showPlaylist", false);
          setState("showVolume", false);
        }
      };
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  });

  const togglePlay = (e: MouseEvent) => {
    e.stopPropagation();
    if (!globalAudio) return;

    if (state.isPlaying) {
      globalAudio.pause();
      setState("isPlaying", false);
    } else {
      globalAudio.play().then(() => {
        setState("isPlaying", true);
      }).catch(console.error);
    }
  };

  const nextMode = (e: MouseEvent) => {
    e.stopPropagation();
    const currentIndex = PLAYBACK_MODES.indexOf(state.currentMode);
    const nextIndex = (currentIndex + 1) % PLAYBACK_MODES.length;
    setState("currentMode", PLAYBACK_MODES[nextIndex]);
  };

  const handleEnded = () => {
    if (localTracks().length === 0) return;
    
    if (state.currentMode === "single") {
      globalAudio?.play().catch(console.error);
    } else if (state.currentMode === "random") {
      const nextIndex = Math.floor(Math.random() * localTracks().length);
      setState("currentTrackIndex", nextIndex);
    } else {
      const nextIndex = (state.currentTrackIndex + 1) % localTracks().length;
      setState("currentTrackIndex", nextIndex);
    }
  };

  const selectTrack = (index: number) => {
    setState("currentTrackIndex", index);
    setState("isPlaying", true);
    setState("showPlaylist", false);
  };

  const handleVolumeChange = (e: any) => {
    const val = parseFloat(e.target.value);
    setState("volume", val);
    if (globalAudio) {
      globalAudio.volume = val;
    }
  };

  createEffect(() => {
    const track = localTracks()[state.currentTrackIndex];
    if (globalAudio && track) {
      const currentSrc = new URL(globalAudio.src, window.location.origin).pathname;
      if (currentSrc !== track) {
        globalAudio.src = track;
        if (state.isPlaying) {
          globalAudio.play().catch(console.error);
        }
      }
    }
  });

  return (
    <div class="music-player-container flex items-center gap-0.5 sm:gap-1 relative">
      {/* Playlist Dropdown */}
      <Show when={state.showPlaylist}>
        <div class="absolute top-full right-0 mt-3 w-56 sm:w-64 max-h-72 overflow-hidden flex flex-col bg-white/90 dark:bg-black/90 border border-black/10 dark:border-white/20 rounded-xl shadow-2xl z-[60] backdrop-blur-md animate-fadeIn">
          <div class="p-3 border-b border-black/5 dark:border-white/10 flex items-center justify-between">
            <span class="text-xs font-bold uppercase tracking-wider text-black/50 dark:text-white/50">Playlist</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-black/40 dark:text-white/40">{localTracks().length} Songs</span>
          </div>
          <div class="overflow-y-auto p-1 custom-scrollbar">
            <For each={localTracks()}>
              {(track, index) => (
                <button
                  onClick={() => selectTrack(index())}
                  class={cn(
                    "w-full text-xs text-left px-3 py-2.5 rounded-lg transition-all flex items-center gap-3 group",
                    state.currentTrackIndex === index() 
                      ? "bg-black/5 dark:bg-white/10 text-black dark:text-white" 
                      : "hover:bg-black/5 dark:hover:bg-white/5 text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white"
                  )}
                >
                  <div class="relative flex items-center justify-center size-4 shrink-0">
                    {state.currentTrackIndex === index() && state.isPlaying ? (
                      <div class="flex items-end gap-[1px] h-3">
                        <div class="w-0.5 bg-current animate-music-bar-1 h-full"></div>
                        <div class="w-0.5 bg-current animate-music-bar-2 h-2/3"></div>
                        <div class="w-0.5 bg-current animate-music-bar-3 h-1/2"></div>
                      </div>
                    ) : (
                      <span class="text-[10px] font-mono opacity-50">{String(index() + 1).padStart(2, '0')}</span>
                    )}
                  </div>
                  <span class="truncate flex-grow">{track.split("/").pop()?.replace(/\.[^/.]+$/, "")}</span>
                  {state.currentTrackIndex === index() && (
                    <div class="size-1.5 rounded-full bg-black dark:bg-white shadow-[0_0_8px_rgba(0,0,0,0.5)] dark:shadow-[0_0_8px_rgba(255,255,255,0.5)]"></div>
                  )}
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Volume Slider Dropdown */}
      <Show when={state.showVolume}>
        <div class="absolute top-full right-0 mt-3 p-4 bg-white/90 dark:bg-black/90 border border-black/10 dark:border-white/20 rounded-2xl shadow-2xl z-[60] backdrop-blur-md animate-fadeIn flex items-center gap-3">
          <svg viewBox="0 0 24 24" class="size-4 fill-none stroke-current opacity-50" stroke-width="2">
            <path d="M11 5L6 9H2v6h4l5 4V5z" />
          </svg>
          <input 
            type="range" 
            min="0" 
            max="1" 
            step="0.01" 
            value={state.volume} 
            onInput={handleVolumeChange}
            class="w-24 sm:w-32 h-1 bg-black/10 dark:bg-white/20 rounded-lg appearance-none cursor-pointer accent-black dark:accent-white"
          />
          <span class="text-[10px] font-mono w-6 opacity-50">{Math.round(state.volume * 100)}%</span>
        </div>
      </Show>

      {/* 1. Playlist Toggle */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setState("showPlaylist", !state.showPlaylist);
          setState("showVolume", false);
        }}
        class={cn(
          "size-8 sm:size-9 rounded-full p-2 sm:p-2.5 items-center justify-center flex",
          "bg-transparent hover:bg-black/5 dark:hover:bg-white/20",
          "stroke-current hover:stroke-black hover:dark:stroke-white",
          "border border-black/10 dark:border-white/25",
          "transition-all duration-300",
          state.showPlaylist ? "bg-black/10 dark:bg-white/25 border-black/20 dark:border-white/40 scale-95 shadow-inner" : ""
        )}
        title="Playlist"
      >
        <svg viewBox="0 0 24 24" class="size-full fill-none stroke-current" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      </button>

      {/* 2. Mode Toggle */}
      <button
        onClick={nextMode}
        class={cn(
          "size-8 sm:size-9 rounded-full p-2 sm:p-2.5 items-center justify-center flex",
          "bg-transparent hover:bg-black/5 dark:hover:bg-white/20",
          "stroke-current hover:stroke-black hover:dark:stroke-white",
          "border border-black/10 dark:border-white/25",
          "transition-all duration-300"
        )}
        title={`Mode: ${state.currentMode}`}
      >
        {state.currentMode === "list" && (
          <svg viewBox="0 0 24 24" class="size-full fill-none stroke-current" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="7 13 12 18 17 13"></polyline>
            <polyline points="7 6 12 11 17 6"></polyline>
          </svg>
        )}
        {state.currentMode === "single" && (
          <svg viewBox="0 0 24 24" class="size-full fill-none stroke-current" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 2l4 4-4 4"></path>
            <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
            <path d="M7 22l-4-4 4-4"></path>
            <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
            <text x="12" y="14" font-size="8" stroke="none" fill="currentColor" text-anchor="middle" font-weight="bold">1</text>
          </svg>
        )}
        {state.currentMode === "random" && (
          <svg viewBox="0 0 24 24" class="size-full fill-none stroke-current" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="16 3 21 3 21 8"></polyline>
            <line x1="4" y1="20" x2="21" y2="3"></line>
            <polyline points="21 16 21 21 16 21"></polyline>
            <path d="M15 15l6 6"></path>
            <path d="M4 4l5 5"></path>
          </svg>
        )}
      </button>

      {/* 3. Play/Pause Toggle */}
      <button
        onClick={togglePlay}
        class={cn(
          "size-8 sm:size-9 rounded-full p-2 sm:p-2.5 items-center justify-center relative overflow-hidden flex",
          "bg-transparent hover:bg-black/5 dark:hover:bg-white/20",
          "stroke-current hover:stroke-black hover:dark:stroke-white",
          "border border-black/10 dark:border-white/25",
          "transition-all duration-300",
          state.isPlaying ? "bg-black dark:bg-white text-white dark:text-black" : ""
        )}
        title={state.isPlaying ? "Pause" : "Play"}
      >
        {state.isPlaying ? (
          <svg viewBox="0 0 24 24" class="size-full fill-current">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" class="size-full fill-current translate-x-0.5">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
        )}
      </button>

      {/* 4. Volume Toggle */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setState("showVolume", !state.showVolume);
          setState("showPlaylist", false);
        }}
        class={cn(
          "size-8 sm:size-9 rounded-full p-2 sm:p-2.5 items-center justify-center flex",
          "bg-transparent hover:bg-black/5 dark:hover:bg-white/20",
          "stroke-current hover:stroke-black hover:dark:stroke-white",
          "border border-black/10 dark:border-white/25",
          "transition-all duration-300",
          state.showVolume ? "bg-black/10 dark:bg-white/25 border-black/20 dark:border-white/40 scale-95 shadow-inner" : ""
        )}
        title="Volume"
      >
        <svg viewBox="0 0 24 24" class="size-full fill-none stroke-current" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" class={state.volume > 0.5 ? "opacity-100" : "opacity-30"} />
        </svg>
      </button>

      <style>{`
        @keyframes music-bar-1 { 0%, 100% { height: 4px; } 50% { height: 12px; } }
        @keyframes music-bar-2 { 0%, 100% { height: 10px; } 50% { height: 4px; } }
        @keyframes music-bar-3 { 0%, 100% { height: 6px; } 50% { height: 14px; } }
        .animate-music-bar-1 { animation: music-bar-1 0.8s ease-in-out infinite; }
        .animate-music-bar-2 { animation: music-bar-2 0.8s ease-in-out infinite 0.2s; }
        .animate-music-bar-3 { animation: music-bar-3 0.8s ease-in-out infinite 0.4s; }
        
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fadeIn { animation: fadeIn 0.2s ease-out; }
        
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 10px; }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); }
      `}</style>
    </div>
  );
}
