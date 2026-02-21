import type { CreateSliceResource, Pie, Slice, SliceResource } from "@bakery/shared";
import type { BakeryRepository, SliceWithResources } from "../repos/repository.js";
import type { PortAllocator } from "./portAllocator.js";

export interface SliceCreateInput {
  pie: Pie;
  worktreePath: string;
  branch: string;
  resources: CreateSliceResource[];
}

export interface OrchestratedSlice extends SliceWithResources {
  pieSlug: string;
  routerPort: number;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function buildRouteUrl(host: string, routerPort: number): string {
  const showPort = routerPort !== 80 && routerPort !== 443;
  return `http://${host}${showPort ? `:${routerPort}` : ""}`;
}

export class SliceOrchestrator {
  constructor(
    private readonly repo: BakeryRepository,
    private readonly allocator: PortAllocator,
    private readonly options: {
      hostSuffix: string;
      routerPortProvider: () => number;
    }
  ) {}

  async createSlice(input: SliceCreateInput): Promise<OrchestratedSlice> {
    const ordinal = this.repo.getNextSliceOrdinal(input.pie.id);
    const host = `${slugify(input.pie.slug)}-s${ordinal}.${this.options.hostSuffix}`;

    const allocatedPorts = await this.allocator.allocateMany(input.resources.length, new Set(this.repo.getAllocatedPorts()));
    const routerPort = this.options.routerPortProvider();

    const slice = this.repo.createSlice({
      pieId: input.pie.id,
      ordinal,
      host,
      worktreePath: input.worktreePath,
      branch: input.branch,
      status: "running"
    });

    const assignedResources: SliceResource[] = input.resources.map((resource, index) => {
      const allocatedPort = allocatedPorts[index];
      if (allocatedPort === undefined) {
        throw new Error("Internal port allocation failure");
      }

      let routeHost: string | undefined;
      if (resource.protocol === "http") {
        if (resource.expose === "primary") {
          routeHost = host;
        } else if (resource.expose === "subdomain") {
          routeHost = `${resource.key}.${host}`;
        }
      }

      return {
        key: resource.key,
        protocol: resource.protocol,
        expose: resource.expose,
        allocatedPort,
        ...(routeHost ? { routeHost, routeUrl: buildRouteUrl(routeHost, routerPort) } : {})
      };
    });

    this.repo.addSliceResources(
      slice.id,
      assignedResources.map((resource) => ({
        key: resource.key,
        port: resource.allocatedPort,
        protocol: resource.protocol,
        expose: resource.expose,
        ...(resource.routeHost ? { routeHost: resource.routeHost } : {}),
        isPrimaryHttp: resource.protocol === "http" && resource.expose === "primary"
      }))
    );

    return {
      ...slice,
      resources: assignedResources,
      pieSlug: input.pie.slug,
      routerPort
    };
  }

  async stopSlice(slice: Slice): Promise<void> {
    this.repo.updateSliceStatus(slice.id, "stopped");
  }

  async removeSlice(slice: Slice): Promise<void> {
    this.repo.deleteSlice(slice.id);
  }
}
