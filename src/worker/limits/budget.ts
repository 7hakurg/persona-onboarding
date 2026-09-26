import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";

export class BudgetDO extends DurableObject<Env> {}
