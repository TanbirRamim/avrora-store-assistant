import math
from typing import List, Tuple


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Computes great-circle distance between two geographic coordinates in kilometers.
    """
    R = 6371.0  # Earth's mean radius in kilometers

    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)

    a = (math.sin(d_lat / 2.0) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(d_lon / 2.0) ** 2)

    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


def point_to_segment_distance_km(
    p_lat: float, p_lon: float,
    a_lat: float, a_lon: float,
    b_lat: float, b_lon: float
) -> float:
    """
    Computes minimum distance in km from point P to line segment A-B.
    Projects P onto segment in flat local approximation (valid for local regional scale).
    """
    # Flat-earth approximation projection locally around point
    mean_lat = math.radians((a_lat + b_lat + p_lat) / 3.0)
    kx = math.cos(mean_lat) * 111.32  # km per deg lon
    ky = 111.0                        # km per deg lat

    # Convert coordinates to local km cartesian
    px, py = p_lon * kx, p_lat * ky
    ax, ay = a_lon * kx, a_lat * ky
    bx, by = b_lon * kx, b_lat * ky

    dx = bx - ax
    dy = by - ay
    seg_len_sq = dx * dx + dy * dy

    if seg_len_sq == 0:
        return math.hypot(px - ax, py - ay)

    # Project point P onto line segment AB, clamping t in [0, 1]
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg_len_sq))

    proj_x = ax + t * dx
    proj_y = ay + t * dy

    return math.hypot(px - proj_x, py - proj_y)


def calculate_min_distance_to_frontline(
    store_lat: float,
    store_lon: float,
    frontline_points: List[Tuple[float, float]]
) -> float:
    """
    Finds the minimum distance in kilometers from a store location
    to the frontline vertices and segments.
    """
    if not frontline_points:
        return 999.0

    min_dist = float("inf")

    # If single point
    if len(frontline_points) == 1:
        plat, plon = frontline_points[0]
        return haversine_distance_km(store_lat, store_lon, plat, plon)

    # Check segment by segment for precise proximity
    for i in range(len(frontline_points) - 1):
        a_lat, a_lon = frontline_points[i]
        b_lat, b_lon = frontline_points[i + 1]

        dist = point_to_segment_distance_km(
            store_lat, store_lon,
            a_lat, a_lon,
            b_lat, b_lon
        )
        if dist < min_dist:
            min_dist = dist

    return round(min_dist, 1)
