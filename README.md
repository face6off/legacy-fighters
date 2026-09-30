# Legacy Fighters

Legacy Fighters is an original, animated 2D browser fighting game built with HTML, CSS, JavaScript, Canvas, and the Web Audio API. Every fighter, visual effect, animation, sound, and game mechanic is produced through code; the project has no game-engine dependency.

## Features

- 14 selectable parody fighters with unique speed, power, defence, stamina, silhouettes, hairstyles, gear, titles, and Legacy Moves
- Real-time combat with movement, stamina-limited attacks, blocking, guard breaks, knockback, and specials
- Character-based stamina capacity and recovery, shown by the cyan in-fight bar
- CPU opponent with distance management, blocking, attacking, retreat, and stamina conservation behaviour
- Code-drawn fighter animation, impact particles, screen shake, arena crowd, and HUD
- Keyboard and mobile touch controls
- Responsive layout, pause, sound toggle, rematches, and character reselection
- Bottom-left update log summarizing the game’s development history
- Small dependency-free automated test suite

## Run locally

Install Python 3, open this folder in a terminal, and run:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Controls

| Key | Action |
| --- | --- |
| A / D | Move left / right |
| F | Light attack (low stamina cost) |
| G | Heavy attack (high stamina cost) |
| H | Block (drains stamina) |
| R | Legacy Move when the gold meter is full |
| Escape | Pause |

## Tests

```bash
npm test
```

## Portfolio notes

The roster uses original parody identities and code-drawn designs. No celebrity photographs, voices, logos, official costumes, or copied game assets are included. Before commercial distribution, obtain professional advice regarding the final title, characters, publicity rights, and trademarks.

## Technology

- Semantic HTML5
- Responsive CSS
- JavaScript ES modules
- Canvas 2D API
- Web Audio API
- Node.js built-in test assertions

## Roadmap

- Local two-player mode
- Character-specific animation rigs
- Best-of-three rounds and difficulty settings
- Additional arenas, combos, accessibility options, and gamepad support
- Packaged desktop build

## License

Source code is provided for portfolio and educational use. Character concepts and the Legacy Fighters identity remain original project material.
