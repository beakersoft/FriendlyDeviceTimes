import struct
import zlib
from pathlib import Path


def png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    chunk = chunk_type + data
    crc = zlib.crc32(chunk) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk + struct.pack(">I", crc)


def create_png(width: int, height: int, color: tuple[int, int, int]) -> bytes:
    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)

    r, g, b = color
    row = bytes([0]) + bytes([r, g, b] * width)
    raw_data = row * height

    return (
        signature
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", zlib.compress(raw_data))
        + png_chunk(b"IEND", b"")
    )


def main() -> None:
    icons_dir = Path(__file__).parent.parent / "icons"
    icons_dir.mkdir(parents=True, exist_ok=True)

    # Family Link green-ish accent.
    color = (0x34, 0xA8, 0x53)

    for size in (16, 32, 48, 128):
        png_bytes = create_png(size, size, color)
        (icons_dir / f"icon{size}.png").write_bytes(png_bytes)
        print(f"Created icon{size}.png")


if __name__ == "__main__":
    main()
