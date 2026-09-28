/**
 * The maximum number of days one generated trip can span. Shared by the client
 * (panel blockers, warnings) and the server (create-trip schema, outline
 * schema, day compiler) so neither side can drift from the other again — the
 * client once allowed a 31-day plan that the server refused at generate.
 */
export const MAX_TRIP_DAYS = 7;
