;(() => {
  const species = [
    { id: 'oak', name: 'Oak' },
    { id: 'pine', name: 'Pine' },
    { id: 'cherry', name: 'Cherry blossom' },
    { id: 'cactus', name: 'Cactus' },
  ]

  const stageNames = ['Seed', 'Sprout', 'Sapling', 'Young tree', 'Full tree']

  const shadow = (rx = 14, ry = 2.4) =>
    `<ellipse class="ff-shadow" cx="50" cy="86" rx="${rx}" ry="${ry}"/>`

  const seed = (rx = 9) =>
    `${shadow(rx, 2)}<ellipse class="ff-seed" cx="50" cy="83" rx="4.5" ry="3"/>`

  const oak = [
    seed(),
    `${shadow(12, 2.4)}
    <path class="ff-branch" d="M50 86 V74" stroke-width="2.4"/>
    <ellipse class="ff-leaf" cx="43" cy="73" rx="6.5" ry="3.6" transform="rotate(-28 43 73)"/>
    <ellipse class="ff-leaf-soft" cx="57" cy="76" rx="6" ry="3.3" transform="rotate(26 57 76)"/>`,
    `${shadow(15, 2.6)}
    <path class="ff-branch" d="M50 86 V64" stroke-width="3"/>
    <circle class="ff-leaf-soft" cx="40" cy="62" r="7"/>
    <circle class="ff-leaf-soft" cx="60" cy="61" r="7"/>
    <circle class="ff-leaf" cx="50" cy="57" r="11"/>`,
    `${shadow(18, 2.8)}
    <path class="ff-branch" d="M50 86 V54" stroke-width="4"/>
    <path class="ff-branch" d="M50 65 L40 57 M50 62 L60 56" stroke-width="2.4"/>
    <circle class="ff-leaf-soft" cx="35" cy="52" r="9"/>
    <circle class="ff-leaf-soft" cx="65" cy="51" r="9"/>
    <circle class="ff-leaf" cx="50" cy="45" r="14"/>
    <circle class="ff-leaf" cx="43" cy="35" r="8"/>
    <circle class="ff-leaf-soft" cx="58" cy="36" r="8"/>`,
    `${shadow(22, 3)}
    <path class="ff-branch" d="M50 88 V48" stroke-width="5"/>
    <path class="ff-branch" d="M50 63 L36 53 M50 58 L64 49 M50 69 L41 62" stroke-width="3"/>
    <circle class="ff-leaf-soft" cx="31" cy="49" r="13"/>
    <circle class="ff-leaf-soft" cx="69" cy="47" r="14"/>
    <circle class="ff-leaf-soft" cx="50" cy="26" r="12"/>
    <circle class="ff-leaf" cx="50" cy="39" r="17"/>
    <circle class="ff-leaf" cx="39" cy="31" r="10"/>
    <circle class="ff-leaf" cx="62" cy="33" r="10"/>
    <circle class="ff-leaf" cx="50" cy="52" r="12"/>`,
  ]

  const pine = [
    seed(8),
    `${shadow(10, 2.2)}
    <path class="ff-branch" d="M50 86 V74" stroke-width="2.2"/>
    <path class="ff-branch" d="M50 77 L43 71 M50 77 L57 71" stroke-width="2"/>
    <path class="ff-leaf" d="M50 68 L45 77 L55 77 Z"/>`,
    `${shadow(13, 2.4)}
    <path class="ff-branch" d="M50 86 V72" stroke-width="3"/>
    <path class="ff-leaf" d="M50 46 L37 78 L63 78 Z"/>`,
    `${shadow(16, 2.6)}
    <path class="ff-branch" d="M50 86 V70" stroke-width="3.4"/>
    <path class="ff-leaf-soft" d="M50 56 L36 82 L64 82 Z"/>
    <path class="ff-leaf" d="M50 42 L38 72 L62 72 Z"/>`,
    `${shadow(20, 2.8)}
    <path class="ff-branch" d="M50 88 V68" stroke-width="4"/>
    <path class="ff-leaf-soft" d="M50 54 L26 84 L74 84 Z"/>
    <path class="ff-leaf" d="M50 38 L31 70 L69 70 Z"/>
    <path class="ff-leaf" d="M50 22 L35 54 L65 54 Z"/>`,
  ]

  const cherry = [
    seed(),
    `${shadow(11, 2.2)}
    <path class="ff-branch" d="M50 86 V74" stroke-width="2.3"/>
    <ellipse class="ff-leaf" cx="44" cy="73" rx="6" ry="3.3" transform="rotate(-26 44 73)"/>
    <circle class="ff-blossom" cx="56" cy="71" r="3"/>`,
    `${shadow(14, 2.4)}
    <path class="ff-branch" d="M50 86 V66" stroke-width="3"/>
    <circle class="ff-blossom-soft" cx="42" cy="62" r="6"/>
    <circle class="ff-blossom-soft" cx="58" cy="61" r="6"/>
    <circle class="ff-blossom" cx="50" cy="57" r="9"/>`,
    `${shadow(17, 2.6)}
    <path class="ff-branch" d="M50 86 V55" stroke-width="3.6"/>
    <path class="ff-branch" d="M50 66 L42 60 M50 64 L58 58" stroke-width="2.2"/>
    <circle class="ff-blossom-soft" cx="36" cy="53" r="8"/>
    <circle class="ff-blossom-soft" cx="64" cy="52" r="8"/>
    <circle class="ff-blossom" cx="50" cy="46" r="13"/>
    <circle class="ff-blossom" cx="43" cy="37" r="7"/>
    <circle class="ff-blossom-soft" cx="58" cy="38" r="7"/>`,
    `${shadow(21, 2.8)}
    <path class="ff-branch" d="M50 88 V48" stroke-width="4.6"/>
    <path class="ff-branch" d="M50 63 L36 53 M50 58 L64 49 M50 69 L41 62" stroke-width="2.8"/>
    <circle class="ff-blossom-soft" cx="32" cy="49" r="12"/>
    <circle class="ff-blossom-soft" cx="68" cy="47" r="13"/>
    <circle class="ff-blossom-soft" cx="50" cy="27" r="11"/>
    <circle class="ff-blossom" cx="50" cy="39" r="16"/>
    <circle class="ff-blossom" cx="39" cy="31" r="9"/>
    <circle class="ff-blossom" cx="62" cy="33" r="9"/>
    <circle class="ff-blossom" cx="50" cy="52" r="11"/>
    <circle class="ff-blossom" cx="27" cy="61" r="2.2"/>
    <circle class="ff-blossom" cx="73" cy="66" r="2"/>
    <circle class="ff-blossom-soft" cx="67" cy="72" r="1.8"/>`,
  ]

  const cactus = [
    seed(7),
    `${shadow(9, 2)}
    <rect class="ff-cactus" x="46" y="72" width="8" height="14" rx="4"/>`,
    `${shadow(12, 2.2)}
    <rect class="ff-cactus" x="44" y="60" width="12" height="26" rx="6"/>
    <path class="ff-cactus-rib" d="M50 66 V82"/>`,
    `${shadow(14, 2.4)}
    <rect class="ff-cactus" x="44" y="50" width="13" height="36" rx="6.5"/>
    <path class="ff-cactus-arm" d="M44 66 H37 V57"/>
    <path class="ff-cactus-rib" d="M50 57 V82"/>`,
    `${shadow(16, 2.6)}
    <rect class="ff-cactus" x="43" y="38" width="14" height="48" rx="7"/>
    <path class="ff-cactus-arm" d="M43 62 H34 V51"/>
    <path class="ff-cactus-arm" d="M57 70 H66 V59"/>
    <path class="ff-cactus-rib" d="M50 46 V82"/>
    <circle class="ff-flower" cx="50" cy="36" r="4"/>
    <circle class="ff-flower-core" cx="50" cy="36" r="1.6"/>`,
  ]

  const builders = { oak, pine, cherry, cactus }

  function render(id, stage, dead = false) {
    const safeId = builders[id] ? id : 'oak'
    const index = Math.max(0, Math.min(4, Math.floor(Number(stage)) || 0))
    const body = builders[safeId][index]
    return `<svg class="ff-tree species-${safeId}${dead ? ' dead' : ''}" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${body}</svg>`
  }

  window.ForestTrees = { species, stageNames, render }
})()
