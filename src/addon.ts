import { config } from "../package.json";
import hooks from "./hooks";

export interface GraphCacheStatus {
  metricRecords: number;
  manualRelations: number;
  ignoredRelations: number;
  lastUpdated: string | null;
}

export interface MeristemaAPI {
  refreshAll(): void;
  clearAllCachedData(): void;
  providerSelectionChanged(): void;
  openOpenAlexAccount(): void;
  cacheStatus(): GraphCacheStatus;
}

function unavailableAPI(): MeristemaAPI {
  const unavailable = (): never => {
    throw new Error("Meristema API is not initialized.");
  };
  return Object.freeze({
    refreshAll: unavailable,
    clearAllCachedData: unavailable,
    providerSelectionChanged: unavailable,
    openOpenAlexAccount: unavailable,
    cacheStatus: unavailable,
  });
}

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized: boolean;
    locale?: { current: any };
  };

  public hooks: typeof hooks;
  public api: MeristemaAPI;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
    };
    this.hooks = hooks;
    this.api = unavailableAPI();
  }

  public setAPI(api: MeristemaAPI): void {
    this.api = Object.freeze({ ...api });
  }
}

export default Addon;
