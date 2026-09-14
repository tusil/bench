import { projectAction } from "../../../utils/http";

export default defineEventHandler((event) => projectAction(event, "down"));
