export class UserError extends Error {}

/** @param {() => void} main @returns {void} */
export function runCli(main) {
  try {
    main();
  } catch (err) {
    if (!(err instanceof UserError)) throw err;
    console.error(`harry: ${err.message}`);
    process.exitCode = 1;
  }
}
