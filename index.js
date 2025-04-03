// app.js
import * as d3 from "d3";

const DEFAULT_OUTLET = "abc News";

// Shared constants
const bias_mapping = {
  farLeft: -2,
  left: -2,
  leanLeft: -1,
  center: 0,
  unknown: 0,
  leanRight: 1,
  right: 2,
  farRight: 2,
};

const bias_mapping_reverse = {
  "-2": "Left",
  "-1": "Center-Left",
  "0": "Center",
  "1": "Center-Right",
  "2": "Right",
};

const numbered = (num) => {
  return num === 1 ? "1st" : num === 2 ? "2nd" : num === 3 ? "3rd" : num + "th";
};

class ArticleList {
  constructor(containerId, onStorySelect) {
    this.container = d3.select(`#${containerId}`);
    this.onStorySelect = onStorySelect;
    this.stories = [];
    this.limit = 9;
  }

  async loadData(url, storyFilter) {
    try {
      this.stories = await d3.json(url);
      if (storyFilter) {
        this.applyFilter(storyFilter);
      } else
        this.render();
    } catch (error) {
      console.error("Error loading data:", error);
    }
  }

  // Method to filter stories by source_name
  applyFilter(storyFilter) {
    if (!storyFilter || !storyFilter.source_name) {
      // If no filter is applied, show all stories
      this.filteredStories = this.stories;
    } else {
      // Otherwise, filter stories whose source_name contains the filter text
      this.filteredStories = this.stories.filter((story) => {
        const filteredArticle = story.articles.filter((article) => article.source_name === storyFilter.source_name);
        if (filteredArticle.length == 0)
          return false;

        if ((filteredArticle[0].bias - 2) == bias_mapping[filteredArticle[0].source_bias])
          return false;

        story.title = filteredArticle[0].title;
        story.url = filteredArticle[0].url;
        story.bias = filteredArticle[0].bias;
        return true;
      }
      );
    }
    this.render();
  }

  render() {
    // Use filteredStories (or all stories if no filter is applied)
    const dataToRender = (this.filteredStories || this.stories).slice(0, this.limit);

    this.container
      .selectAll(".story-card")
      .data(dataToRender, (d) => d.id) // assuming stories have unique id
      .join("div")
      .attr("class", "story-card")
      .html(
        (d) => `
            <h3>${d.title}</h3>
            <div class="metrics">
              <div class="metric">
                <span class="label">Bias:</span>
                <span class="value">${bias_mapping_reverse[d.bias - 2]}</span>
              </div>
              <div class="metric">
                <span class="label">Controversy:</span>
                <span class="value">${d.surprise_index.toFixed(2)}</span>
              </div>
            </div>
            ${
              d.first_to_threshold
                ? `
            <div class="threshold">
              Polarized from the ${numbered(d.first_to_threshold)} post
            </div>`
                : ""
            }
          `
      )
      .on("click", (event, storyData) => {
        // Open a new tab with the story URL
        window.open(storyData.url, "_blank");
        // Call the onStorySelect callback if provided
        if (this.onStorySelect) {
          this.onStorySelect(storyData);
        }
      });
  }
}


class MediaBiasVisualizer {
  constructor() {
    // Create a tooltip element used by multiple charts
    this.tooltip = d3
      .select("body")
      .append("div")
      .attr("class", "tooltip")
      .style("opacity", 0);
    // Predefined bias categories for the distribution chart
    this.categories = ["Left", "Center-Left", "Center", "Center-Right", "Right"];
    // Current mode for treemap coloring (0 = source bias, 1 = mean bias)
    this.coloringMode = 0;
  }

  init() {
    this.initCounters();
    this.initObserver();
    this.loadData();
    this.setupToggleButtons();
  }

  // Animate the counters at the top of the page
  initCounters() {
    this.animateCounter("#total-articles", 63847);
    this.animateCounter("#total-stories", 6412);
    this.animateCounter("#num-sources", 3246);
  }

  animateCounter(selector, target) {
    const el = document.querySelector(`${selector} span`);
    let count = 0;
    const increment = Math.ceil(target / 100);
    const interval = setInterval(() => {
      count += increment;
      if (count >= target) {
        count = target;
        clearInterval(interval);
      }
      el.textContent = count;
    }, 20);
  }

  // Set up an Intersection Observer to animate sections on scroll
  initObserver() {
    const sections = document.querySelectorAll(".sentinel");
    const observerOptions = { threshold: 0.3 };
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.closest("section").classList.add("visible");
      });
    }, observerOptions);
    sections.forEach((section) => observer.observe(section));
  }

  // Load the CSV data and initialize the charts
  loadData() {
    d3.csv("dist/source_bias.csv", d3.autoType).then((data) => {
      // Initialize the distribution chart using a featured source
      const featured =
        data.find((d) => d.source_name.includes(DEFAULT_OUTLET)) || {
          source_name: DEFAULT_OUTLET,
          bias_dist: "[5,15,20,20,20,15,5]",
        };
      this.updateDistributionChart(featured);

      // Filter data for the scatter plot and build it
      const biasData = data.filter((d) => d.topic_story_count > 100);
      this.initScatterPlot(biasData);
      // Build the treemap from all data
      this.initTreemap(data);
    });
  }

  // Update the bias distribution bar chart for a given media source
  updateDistributionChart(storyData) {
    const {
      source_name: sourceName, surprising_dist: surprisingDistRaw, unsurprising_dist: unsurprisingDistRaw, source_bias: sourceBias,
    } = storyData;
    const distSvg = d3.select("#distribution-chart");
    distSvg.selectAll("*").remove();
    document.getElementById("distribution-title").textContent = `Bias Distribution: ${sourceName}`;
  
    const margin = { top: 20, right: 30, bottom: 70, left: 70 };
    const width = distSvg.node().getBoundingClientRect().width - margin.left - margin.right;
    const height = distSvg.node().getBoundingClientRect().height - margin.top - margin.bottom;
  
    const g = distSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  
    // Parse JSON strings like "[5,10,15,20,25]"
    const surprising = JSON.parse(surprisingDistRaw);
    const unsurprising = JSON.parse(unsurprisingDistRaw);
  
    const data = this.categories.map((label, i) => ({
      category: label,
      surprising: surprising[i] || 0,
      unsurprising: unsurprising[i] || 0,
    }));
  
    // Stack the two series
    const stack = d3.stack().keys(["surprising", "unsurprising"]);
    const series = stack(data);
  
    const x = d3.scaleBand().domain(this.categories).range([0, width]).padding(0.2);
    const y = d3.scaleLinear()
      .domain([0, d3.max(data, d => d.surprising + d.unsurprising)])
      .range([height, 0]);
  
    // Axes
    g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x));
  
    g.append("g").call(d3.axisLeft(y));
  
    // Colors
    const color = d3.scaleOrdinal()
      .domain(["surprising", "unsurprising"])
      .range(["#ffeb3b", "#b1b1b1"]);
  
    // Bars
    g.selectAll("g.layer")
      .data(series)
      .enter()
      .append("g")
      .attr("class", "layer")
      .attr("fill", d => color(d.key))
      .selectAll("rect")
      .data(d => d)
      .enter()
      .append("rect")
      .attr("x", d => x(d.data.category))
      .attr("y", d => y(d[1]))
      .attr("height", d => y(d[0]) - y(d[1]))
      .attr("width", x.bandwidth())
      .on("mouseover", (event, d) => {
        this.tooltip.transition().duration(200).style("opacity", 0.9);
        const total = d[1] - d[0];
        this.tooltip
          .html(`${total} articles`)
          .style("left", `${event.pageX + 10}px`)
          .style("top", `${event.pageY - 28}px`);
      })
      .on("mouseout", () => {
        this.tooltip.transition().duration(500).style("opacity", 0);
      });
  
    // X-axis label
    g.append("text")
      .attr("x", width / 2)
      .attr("y", height + 50)
      .attr("text-anchor", "middle")
      .style("font-size", "14px")
      .text("Bias Category");
  
    // Legend
    const legend = distSvg.append("g").attr("transform", `translate(${width - 100}, 10)`);
  
    ["Controversial", "Not Controversial"].forEach((key, i) => {
      const yOffset = i * 20;
      legend
        .append("rect")
        .attr("x", 0)
        .attr("y", yOffset)
        .attr("width", 15)
        .attr("height", 15)
        .attr("fill", color(key));
      legend
        .append("text")
        .attr("x", 20)
        .attr("y", yOffset + 12)
        .text(key.charAt(0).toUpperCase() + key.slice(1))
        .attr("font-size", "12px");
    });

    // Add comparison text
    const totalSurprising = surprising.reduce((sum, v) => sum + v, 0);
    const totalUnsurprising = unsurprising.reduce((sum, v) => sum + v, 0);
    const total = totalSurprising + totalUnsurprising;

    let alignedSurprising = 0, alignedUnsurprising = 0, deviantSurprising = 0, deviantUnsurprising = 0;

    for (let i = 0; i < 5; i++) {
      if (i - 2 === sourceBias) {
        alignedSurprising += surprising[i] || 0;
        alignedUnsurprising += unsurprising[i] || 0;
      } else {
        deviantSurprising += surprising[i] || 0;
        deviantUnsurprising += unsurprising[i] || 0;
      }
    }

    const alignedTotal = alignedSurprising + alignedUnsurprising;
    const deviantTotal = deviantSurprising + deviantUnsurprising;

    const alignedPct = alignedTotal > 0 ? (alignedSurprising / alignedTotal) * 100 : 0;
    const deviantPct = deviantTotal > 0 ? (deviantSurprising / deviantTotal) * 100 : 0;

    d3.select("#bias-contrast-text").html(
      `</strong> Among <strong>Spontaneous Articles</strong> whose bias aligns with the outlet bias, <strong>${alignedPct.toFixed(1)}%</strong> are controversial.<br>Among <strong>Deviant Articles</strong>, <strong>${deviantPct.toFixed(1)}%</strong> are controversial.`
    );

  }
  

  // Initialize the scatter plot of outlet bias vs. article bias
  initScatterPlot(biasData) {
    const scatterSvg = d3.select("#landscape-chart"),
      scatterMargin = { top: 20, right: 30, bottom: 70, left: 70 },
      scatterWidth = scatterSvg.node().getBoundingClientRect().width - scatterMargin.left - scatterMargin.right,
      scatterHeight = 500 - scatterMargin.top - scatterMargin.bottom;

    const scatterG = scatterSvg
      .append("g")
      .attr("transform", `translate(${scatterMargin.left},${scatterMargin.top})`);

    const xScale = d3.scaleLinear().domain(d3.extent(biasData, (d) => d.source_bias)).nice().range([0, scatterWidth]);
    const yScale = d3.scaleLinear().domain(d3.extent(biasData, (d) => d.mean_bias)).nice().range([scatterHeight, 0]);
    const rScale = d3.scaleSqrt().domain([0, d3.max(biasData, (d) => d.total_story_count)]).range([4, 35]);

    scatterG
      .append("g")
      .attr("transform", `translate(0,${scatterHeight})`)
      .call(
        d3.axisBottom(xScale)
          .tickValues([-2, -1, 0, 1, 2])
          .tickFormat((d) => this.categories[d + 2] || d)
      );

    scatterG.append("g").call(
      d3
        .axisLeft(yScale)
        .tickValues([-2, -1, 0, 1, 2])
        .tickFormat((d) => (d === -2 ? "Left" : d === 2 ? "Right" : d))
    );

    scatterG
      .append("text")
      .attr("x", scatterWidth / 2)
      .attr("y", scatterHeight + 50)
      .attr("text-anchor", "middle")
      .attr("font-size", "14px")
      .text("Media Outlet Bias Rating");

    scatterG
      .append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -scatterHeight / 2)
      .attr("y", -50)
      .attr("text-anchor", "middle")
      .attr("font-size", "14px")
      .text("Mean Article Bias");

    const source_bias_colors = {
      "-2": "#08305B",
      "-1": "#2272B2",
      "0": "#D0D1D5",
      "1": "#FB6A4A",
      "2": "#A50F15",
    };

    const circles = scatterG
      .selectAll("circle")
      .data(biasData)
      .enter()
      .append("circle")
      .attr("cx", (d) => xScale(d.source_bias))
      .attr("cy", (d) => yScale(d.mean_bias))
      .attr("r", (d) => rScale(d.total_story_count))
      .attr("fill", (d) => source_bias_colors[d.source_bias] || "#999")
      .attr("opacity", 0.8)
      .on("mouseover", (event, d) => {
        d3.select(event.currentTarget).attr("stroke-width", 2).attr("stroke", "#000");
        this.tooltip.transition().duration(200).style("opacity", 0.9);
        this.tooltip
          .html(
            `<strong>${d.source_name}</strong><br/>Outlet Bias: ${d.source_bias}<br/>Mean Bias: ${d.mean_bias.toFixed(
              2
            )}<br/>Total Stories: ${Math.round(d.total_story_count)}`
          )
          .style("left", `${event.pageX + 10}px`)
          .style("top", `${event.pageY - 28}px`);
      })
      .on("mouseout", (event, d) => {
        if (!d3.select(event.currentTarget).classed("selected-circle")) {
          d3.select(event.currentTarget).attr("stroke-width", 0);
        }
        this.tooltip.transition().duration(500).style("opacity", 0);
      })
      .on("click", (event, d) => {
        // Remove previous selections and mark this circle as selected
        circles.classed("selected-circle", false).attr("stroke-width", 0);
        d3.select(event.currentTarget)
          .classed("selected-circle", true)
          .attr("stroke-width", 3)
          .attr("stroke", "#000");
        
        // Update the bias distribution chart for the selected outlet
        this.updateDistributionChart(d);
        
        // Filter the news list by the selected source name
        // (Assuming your StoryVisualizerApp instance is stored in a global variable "stories")
        articleList.applyFilter({source_name: d.source_name});
      });

    // Highlight the featured outlet if present
    const featuredCircle = circles.filter((d) => d.source_name.includes(DEFAULT_OUTLET));
    if (!featuredCircle.empty()) {
      featuredCircle.classed("selected-circle", true).attr("stroke-width", 3).attr("stroke", "#000");
    }
  }

  // Build the treemap visualization of media ownership
  initTreemap(data) {
    // Group data by owner
    const ownershipData = { name: "Media Owners", children: [] };
    const ownerMap = new Map();
    data.forEach((d) => {
      if (d.source_owners && d.source_owners.trim() !== "") {
        const owners = d.source_owners.split(",").map((o) => o.trim());
        owners.forEach((owner) => {
          if (!ownerMap.has(owner)) {
            ownerMap.set(owner, {
              name: owner,
              children: [],
              total_count: 0,
            });
          }
          const ownerNode = ownerMap.get(owner);
          ownerNode.children.push({
            name: d.source_name,
            value: d.total_story_count || 0,
            topic_story_count: d.topic_story_count,
            source_bias: d.source_bias,
            mean_bias: d.mean_bias,
            source_owners: d.source_owners,
          });
          ownerNode.total_count += d.total_story_count || 0;
        });
      }
    });
    ownerMap.forEach((value, key) => {
      if (value.children.length > 1 || value.total_count > 10000) {
        ownershipData.children.push(value);
      }
    });
    ownershipData.children.sort((a, b) => b.total_count - a.total_count);
    ownershipData.children = ownershipData.children.slice(0, 20);

    const treemapSvg = d3.select("#ownership-chart"),
      treemapMargin = { top: 60, right: 20, bottom: 20, left: 20 },
      treemapWidth = treemapSvg.node().getBoundingClientRect().width - treemapMargin.left - treemapMargin.right,
      treemapHeight = treemapSvg.node().getBoundingClientRect().height - treemapMargin.top - treemapMargin.bottom;

    const treemapG = treemapSvg
      .append("g")
      .attr("transform", `translate(${treemapMargin.left},${treemapMargin.top})`);

    const root = d3
      .hierarchy(ownershipData)
      .sum((d) => d.value)
      .sort((a, b) => b.value - a.value);

    d3.treemap().tile(d3.treemapSquarify).size([treemapWidth, treemapHeight]).padding(1.5)(root);

    // Define color scales
    const sourceBiasColorScale = d3
      .scaleLinear()
      .domain([-2, -1, 0, 1, 2])
      .range(["#08305B", "#2272B2", "#c0c0c0", "#FB6A4A", "#A50F15"]);

    const meanBiasColorScale = d3
      .scaleLinear()
      .domain([-2, -1, 0.1, 0, 1, 2])
      .range(["#08305B", "#2272B2", "#c0c0c0", "#FB6A4A", "#A50F15"]);

    // Function to update treemap colors based on the current mode
    const updateTreemapColors = () => {
      treemapG
        .selectAll(".treemap-rect")
        .attr("fill", (d) => {
          if (this.coloringMode === 0) {
            return sourceBiasColorScale(d.data.source_bias || 0);
          } else {
            return meanBiasColorScale(d.data.mean_bias || 0);
          }
        });
    };

    // Draw outlines for parent (owner) nodes
    treemapG
      .selectAll(".owner-rect")
      .data(root.children)
      .enter()
      .append("rect")
      .attr("class", "owner-rect")
      .attr("x", (d) => d.x0)
      .attr("y", (d) => d.y0)
      .attr("width", (d) => d.x1 - d.x0)
      .attr("height", (d) => d.y1 - d.y0)
      .attr("fill", "none")
      .attr("stroke", "#777")
      .attr("stroke-width", 2);

    // Draw the treemap leaf rectangles
    const treemapRects = treemapG
      .selectAll(".treemap-rect")
      .data(root.leaves())
      .enter()
      .append("rect")
      .attr("class", "treemap-rect")
      .attr("x", (d) => d.x0)
      .attr("y", (d) => d.y0)
      .attr("width", (d) => d.x1 - d.x0)
      .attr("height", (d) => d.y1 - d.y0)
      .attr("fill", (d) => sourceBiasColorScale(d.data.source_bias || 0))
      .attr("stroke", "#fff")
      .on("mouseover", (event, d) => {
        d3.select(event.currentTarget).attr("stroke", "#000").attr("stroke-width", 2);
        this.tooltip.transition().duration(200).style("opacity", 0.9);
        if (d.data.mean_bias !== undefined) {
          this.tooltip
            .html(
              `<strong>${d.data.name}</strong><br/>Owner: ${d.data.source_owners}<br/>Stories: ${d.data.topic_story_count}<br/>Outlet Bias: ${d.data.source_bias}<br/>Mean Bias: ${d.data.mean_bias?.toFixed(2) || 'N/A'}`
            )
            .style("left", `${event.pageX + 10}px`)
            .style("top", `${event.pageY - 28}px`);
        }
      })
      .on("mouseout", (event, d) => {
        d3.select(event.currentTarget).attr("stroke-width", 0);
        this.tooltip.transition().duration(500).style("opacity", 0);
      });

    // Add clip paths to constrain labels within rectangles
    treemapG
      .selectAll("clipPath")
      .data(root.leaves())
      .enter()
      .append("clipPath")
      .attr("id", (d) => `clip-${d.data.name.replace(/\s+/g, "-")}`)
      .append("rect")
      .attr("x", (d) => d.x0)
      .attr("y", (d) => d.y0)
      .attr("width", (d) => d.x1 - d.x0)
      .attr("height", (d) => d.y1 - d.y0);

    // Add text labels with clipping
    treemapG
      .selectAll(".treemap-label")
      .data(root.leaves())
      .enter()
      .append("text")
      .attr("class", "treemap-label")
      .attr("clip-path", (d) => `url(#clip-${d.data.name.replace(/\s+/g, "-")})`)
      .attr("x", (d) => d.x0 + 4)
      .attr("y", (d) => d.y0 + 14)
      .text((d) => d.data.name)
      .attr("font-size", (d) => {
        const width = d.x1 - d.x0;
        const height = d.y1 - d.y0;
        const area = width * height;
        if (area < 1000) return "5px";
        if (area < 5000) return "10px";
        return "12px";
      })
      .attr("pointer-events", "none");

    // Update treemap colors initially
    updateTreemapColors();

    // Toggle buttons for changing treemap coloring mode
    document.getElementById("toggle-source-bias").addEventListener("click", () => {
      this.coloringMode = 0;
      document.getElementById("toggle-source-bias").classList.add("active");
      document.getElementById("toggle-mean-bias").classList.remove("active");
      updateTreemapColors();
    });

    document.getElementById("toggle-mean-bias").addEventListener("click", () => {
      this.coloringMode = 1;
      document.getElementById("toggle-mean-bias").classList.add("active");
      document.getElementById("toggle-source-bias").classList.remove("active");
      updateTreemapColors();
    });
  }

  // Setup for toggle buttons (if any additional functionality is needed)
  setupToggleButtons() {
    // Currently, event listeners are defined in initTreemap.
  }
}

// Instantiate and initialize the visualizer
const articleList = new ArticleList("stories")
const visualizer = new MediaBiasVisualizer();

visualizer.init()
articleList.loadData("dist/israeli-palestinian-conflict.json", {source_name: DEFAULT_OUTLET});
