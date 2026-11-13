/**
 * Two slow drifting lights behind a section, as on the dashboard hero: the white accent at a
 * fraction of its strength, blurred, each on its own long loop (still under reduced motion).
 */
export function Glows() {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[-30%] left-[4%] -z-10 aspect-square w-[62%] glow-a rounded-full bg-radial-[closest-side] from-accent/17 to-accent/0 blur-[30px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[-8%] bottom-[-55%] -z-10 aspect-square w-[70%] glow-b rounded-full bg-radial-[closest-side] from-accent/11 to-accent/0 blur-[40px]"
      />
    </>
  );
}
