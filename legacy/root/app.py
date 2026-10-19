import random
import sys
import time
from datetime import datetime

# -----------------------------
# Colours
# -----------------------------
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"

WHITE = "\033[97m"
GRAY = "\033[90m"
GREEN = "\033[92m"
CYAN = "\033[96m"
BLUE = "\033[94m"
YELLOW = "\033[93m"
MAGENTA = "\033[95m"
RED = "\033[91m"

INFO = f"{CYAN}●{RESET}"
OK = f"{GREEN}✓{RESET}"
WARN = f"{YELLOW}▲{RESET}"
STEP = f"{MAGENTA}◆{RESET}"

# -----------------------------

def ts():
    return datetime.now().strftime("%H:%M:%S")


def p(line="", delay=(0.04, 0.12)):
    print(line)
    sys.stdout.flush()
    time.sleep(random.uniform(*delay))


def divider(title):
    p("")
    p(f"{GRAY}{'─'*58}{RESET}")
    p(f"{BOLD}{WHITE}{title}{RESET}")
    p(f"{GRAY}{'─'*58}{RESET}")


def progress():
    width = random.randint(18, 32)
    value = random.randint(10, width)

    filled = "█" * value
    empty = "░" * (width - value)

    pct = int(value / width * 100)

    p(f"{BLUE}[{filled}{empty}]{RESET} {GREEN}{pct}%{RESET}")


def status():
    comp = random.choice([
        "Renderer",
        "Vision",
        "Scheduler",
        "Pipeline",
        "Database",
        "Inference",
        "Network",
        "Storage",
        "Audio",
        "GPU"
    ])

    msg = random.choice([
        "Initializing",
        "Loading assets",
        "Synchronizing",
        "Compiling shaders",
        "Resolving dependencies",
        "Caching textures",
        "Updating state",
        "Streaming buffers",
        "Optimizing graph",
        "Generating embeddings",
        "Processing frame",
        "Loading checkpoint"
    ])

    metric = random.choice([
        f"{random.randint(35,180)} FPS",
        f"{random.uniform(0.5,7):.2f} ms",
        f"CPU {random.randint(5,35)}%",
        f"GPU {random.randint(20,95)}%",
        f"RAM {random.uniform(1.5,6.8):.1f} GB",
        f"{random.randint(300,9000)} objects"
    ])

    icon = random.choice([INFO, OK, STEP])

    p(
        f"{GRAY}[{ts()}]{RESET} {icon} "
        f"{WHITE}{comp:<11}{RESET} "
        f"{DIM}{msg}{RESET} "
        f"{GREEN}{metric}{RESET}"
    )


def substeps():
    count = random.randint(3, 6)

    for _ in range(count):
        txt = random.choice([
            "Reading configuration",
            "Loading module",
            "Resolving imports",
            "Checking cache",
            "Building graph",
            "Scanning resources",
            "Uploading buffers",
            "Preparing runtime",
            "Allocating memory",
            "Opening dataset"
        ])

        p(
            f"{GRAY}[{ts()}]{RESET}    "
            f"{MAGENTA}↳{RESET} "
            f"{DIM}{txt}{RESET}"
        )


def kv_block():

    divider(random.choice([
        "Renderer",
        "Runtime",
        "Dataset",
        "Performance",
        "Session",
        "Network"
    ]))

    rows = {
        "Backend": random.choice(["OpenGL", "Vulkan", "DirectX12"]),
        "Threads": random.randint(4, 24),
        "GPU": random.choice([
            "GTX 1660",
            "RTX 4070",
            "RTX 3080",
            "RX 7800 XT"
        ]),
        "Resolution": random.choice([
            "900x1600",
            "1920x1080",
            "2560x1440"
        ]),
        "Cache": f"{random.randint(128,1024)} MB",
        "Latency": f"{random.uniform(0.5,6):.2f} ms"
    }

    for k, v in random.sample(list(rows.items()), random.randint(4, 6)):
        p(f"{CYAN}{k:<16}{RESET}: {WHITE}{v}{RESET}")


def json_block():

    divider("Memory Snapshot")

    p("{")

    entries = [
        ("cpu", f"{random.randint(5,30)}%"),
        ("gpu", f"{random.randint(30,90)}%"),
        ("ram", f"{random.uniform(2,8):.1f} GB"),
        ("fps", random.randint(60,180)),
        ("objects", random.randint(1000,9000)),
        ("threads", random.randint(4,20))
    ]

    for i, (k, v) in enumerate(entries):
        comma = "," if i < len(entries)-1 else ""
        p(f"    {BLUE}{k}{RESET}: {GREEN}{v}{RESET}{comma}")

    p("}")


def warning():

    divider(f"{YELLOW}Warning{RESET}")

    p(f"{WARN} Cache miss detected.", (0.08, 0.15))
    p("Rebuilding texture atlas...", (0.08, 0.15))
    p(f"{GREEN}Completed successfully.{RESET}", (0.08, 0.15))


def long_info():

    divider("Analysis")

    text = random.choice([
        "Scanning dependency graph and validating runtime state across all active modules.",
        "Evaluating frame timing consistency while synchronizing GPU resources and render queues.",
        "Building spatial acceleration structures for optimized scene traversal.",
        "Pre-processing dataset before inference and generating metadata cache.",
        "Running integrity checks on cached resources and rebuilding invalid entries."
    ])

    p(f"{DIM}{text}{RESET}", (0.1, 0.2))


def summary():

    divider("Summary")

    rows = [
        ("Modules Loaded", random.randint(12,34)),
        ("Assets Cached", random.randint(500,8500)),
        ("Peak RAM", f"{random.uniform(2,7):.1f} GB"),
        ("Peak GPU", f"{random.randint(40,95)}%"),
        ("Frames", random.randint(800,2400)),
        ("Status", f"{GREEN}SUCCESS{RESET}")
    ]

    for k, v in rows:
        p(f"{WHITE}{k:<18}{RESET} {v}")


# =====================================================

print()
print(f"{BOLD}{WHITE}{'═'*58}{RESET}")
print(f"{BOLD}{WHITE}        Runtime Diagnostic Console v3.2{RESET}")
print(f"{BOLD}{WHITE}{'═'*58}{RESET}")

sections = [
    status,
    status,
    substeps,
    kv_block,
    progress,
    status,
    json_block,
    progress,
    long_info,
    warning
]

for _ in range(18):

    random.choice(sections)()

    if random.random() < 0.35:
        p()

summary()

print()
print(f"{GREEN}✓ Session completed successfully.{RESET}")
print()