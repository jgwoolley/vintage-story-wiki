# VintageStory Schematic Preview

See: https://jgwoolley.github.io/vintage-story-schematic-preview/

Recenter button, be able to search other schematics?

## Test build

```
sh test.sh
```

## TODO

* add no ref to https://github.com/jgwoolley/vintage-story-launcher/blob/main/index.html
* Add build step... to both projects.
* Maybe consistancy?
* Rework selecting built in schematics
* Rework naming
* potentially make a build system?

###

https://github.com/anegostudios/vsapi/blob/master/Math/Ascii85.cs
https://github.com/anegostudios/vsapi/blob/master/Datastructures/AttributeTree/TreeAttribute.cs#L186

### CSHAP project?

https://github.com/anegostudios/Cairo --> Cairo / "cairo-sharp"
https://github.com/anegostudios/vsapi/ --> VintagestoryApi
--> VintagestoryLib
--> 0Harmony
https://github.com/anegostudios/vssurvivalmod --> VSSurvivalMod
https://github.com/anegostudios/vsessentialsmod --> VSEssentials
https://github.com/anegostudios/vscreativemod --> VSCreativeMod

See example
```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <AppendTargetFrameworkToOutputPath>false</AppendTargetFrameworkToOutputPath>
    <RootNamespace>Nf3t.VintageStory.SchematicCli</RootNamespace>
  </PropertyGroup>

  <ItemGroup>
    <ProjectReference Include="Dependencies\vsapi\VintagestoryApi\VintagestoryApi.csproj">
      <Private>false</Private>
    </ProjectReference>
    <ProjectReference Include="Dependencies\vsapi\VintagestoryLib\VintagestoryLib.csproj">
      <Private>false</Private>
    </ProjectReference>
    <ProjectReference Include="Dependencies\vssurvivalmod\VSSurvivalMod.csproj">
      <Private>false</Private>
    </ProjectReference>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3">
        <Private>false</Private>
    </PackageReference>
    <PackageReference Include="protobuf-net" Version="3.2.30">
        <Private>false</Private>
    </ProjectReference>
    <PackageReference Include="Microsoft.Data.Sqlite" Version="8.0.0">
        <Private>false</Private>
    </ProjectReference>
    <PackageReference Include="Lib.Harmony" Version="2.3.3">
        <Private>false</Private>
    </ProjectReference>
    </ItemGroup>
</Project>
```