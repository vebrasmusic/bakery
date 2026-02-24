export type SliceStatus = "creating" | "running" | "stopped" | "error";

export interface Pie {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export type SliceResourceProtocol = "http" | "tcp" | "udp";
export type SliceResourceExpose = "primary" | "subdomain" | "none";

export interface SliceResource {
  key: string;
  protocol: SliceResourceProtocol;
  expose: SliceResourceExpose;
  allocatedPort: number;
  routeHost?: string;
  routeUrl?: string;
}

export interface Slice {
  id: string;
  pieId: string;
  ordinal: number;
  host: string;
  status: SliceStatus;
  createdAt: string;
  stoppedAt: string | null;
}
