import { projectStart } from "../../../utils/http";

export default defineEventHandler(async (event) => {
  const result = await projectStart(event);
  setResponseStatus(event, 202);
  return result;
});
